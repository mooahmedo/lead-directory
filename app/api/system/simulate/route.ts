import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Shared auth check: only supervisor role allowed for simulation operations.
 */
async function checkSupervisorAuth() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { error: 'غير مصرح — يجب تسجيل الدخول', status: 401, user: null, profile: null };

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from('users')
    .select('id, full_name, email, role')
    .eq('email', user.email)
    .single();

  if (!profile || profile.role !== 'supervisor') {
    return { error: 'غير مصرح — صلاحية المشرف مطلوبة', status: 403, user: null, profile: null };
  }

  return { error: null, status: 200, user, profile };
}

/**
 * POST /api/system/simulate
 * Action: 'generate' | 'cleanup'
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSupervisorAuth();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json();
    const { action, count } = body;

    const adminClient = createAdminClient();

    if (action === 'cleanup') {
      // Cleanup simulated data
      // We identify simulated data by the '[SIMULATION]' prefix in the full_name
      const { data, error } = await adminClient.from('patients')
        .delete()
        .like('full_name', '[SIMULATION]%')
        .select('id');
        
      if (error) throw new Error('فشل في مسح بيانات المحاكاة');

      const deletedCount = data?.length || 0;

      await adminClient.from('simulation_logs').insert({
        action: 'removed',
        user_email: auth.user!.email,
        user_name: auth.profile!.full_name,
        record_count: deletedCount
      });

      return NextResponse.json({
        success: true,
        message: `تم تنظيف بيانات المحاكاة بنجاح (حذف ${deletedCount} مريض)`,
        deletedCount
      });
    }

    if (action === 'generate') {
      const recordsToGenerate = count || 50;
      
      // 1. Get random active health unit
      const { data: units } = await adminClient.from('health_units').select('id');
      if (!units || units.length === 0) throw new Error('لا يوجد وحدات صحية لتسجيل البيانات عليها');

      const patientsToInsert = [];
      const visitsToInsert = [];

      for (let i = 0; i < recordsToGenerate; i++) {
        const patientId = crypto.randomUUID();
        const unitId = units[Math.floor(Math.random() * units.length)].id;
        
        // Random stats
        const age = Math.floor(Math.random() * (85 - 18) + 18);
        const gender = Math.random() > 0.5 ? 'ذكر' : 'أنثى';
        const systolic = Math.floor(Math.random() * (180 - 100) + 100);
        const diastolic = Math.floor(Math.random() * (110 - 60) + 60);
        const hasSugar = Math.random() > 0.6;
        
        patientsToInsert.push({
          id: patientId,
          national_id: `2${Math.floor(Math.random() * 10000000000000).toString().padStart(13, '0')}`,
          full_name: `[SIMULATION] مريض تجريبي ${i + 1}`,
          phone: `01${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`,
          governorate: 'سوهاج',
          age: age,
          gender: gender,
          first_visit_date: new Date().toISOString(),
        });

        visitsToInsert.push({
          patient_id: patientId,
          unit_id: unitId,
          visit_type: Math.random() > 0.7 ? 'متابعة' : 'أول مرة',
          visit_date: new Date(Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000)).toISOString(), // Last 7 days
          systolic: systolic,
          diastolic: diastolic,
          sugar_type: hasSugar ? (Math.random() > 0.5 ? 'عشوائي' : 'صائم') : null,
          sugar_level: hasSugar ? Math.floor(Math.random() * (350 - 70) + 70) : null,
          weight: Math.floor(Math.random() * (120 - 50) + 50),
          height: Math.floor(Math.random() * (190 - 150) + 150),
          referred: systolic >= 160 || diastolic >= 100 || (hasSugar && systolic > 250),
          referral_dest: (systolic >= 160 || diastolic >= 100 || (hasSugar && systolic > 250)) ? 'مستشفى سوهاج العام' : null
        });
      }

      const { error: pError } = await adminClient.from('patients').insert(patientsToInsert);
      if (pError) throw new Error('فشل إدخال بيانات المرضى المحاكاة');

      const { error: vError } = await adminClient.from('visits').insert(visitsToInsert);
      if (vError) throw new Error('فشل إدخال بيانات الزيارات المحاكاة');

      await adminClient.from('simulation_logs').insert({
        action: 'generated',
        user_email: auth.user!.email,
        user_name: auth.profile!.full_name,
        record_count: recordsToGenerate
      });

      return NextResponse.json({
        success: true,
        message: `تم توليد ${recordsToGenerate} سجل محاكاة بنجاح`,
        generatedCount: recordsToGenerate
      });
    }

    return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 });
  } catch (err: any) {
    console.error('Simulation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
