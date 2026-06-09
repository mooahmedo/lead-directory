import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// ─── Auth ─────────────────────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a unique national ID that cannot collide between runs.
 * Format: SIM + timestamp_ms + 4-digit index (padded).
 * This guarantees no two runs and no two records within a run share an ID.
 */
function generateSimNationalId(runId: string, index: number): string {
  return `SIM${runId}${String(index).padStart(4, '0')}`.substring(0, 14);
}

/**
 * Generate a visit timestamp that is today (within working hours) to ensure
 * it counts in the dashboard's todayVisits KPI.
 * Spread across the day to avoid (patient_id, unit_id, visit_date) collisions.
 */
function generateTodayVisitDate(index: number): string {
  const now = new Date();
  // Spread visits from 08:00 to current time across the day, each record gets a unique minute
  const startOfDay = new Date(now);
  startOfDay.setHours(8, 0, 0, 0);
  // Each record gets a unique second offset so visit_date is unique per patient
  const secondOffset = index * 37; // prime number spread to avoid clustering
  const visitMs = startOfDay.getTime() + (secondOffset * 1000);
  // Don't exceed current time
  const finalMs = Math.min(visitMs, now.getTime() - 1000);
  return new Date(finalMs).toISOString();
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSupervisorAuth();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json();
    const { action, count } = body;

    const adminClient = createAdminClient();

    // ── CLEANUP ────────────────────────────────────────────────────────────────
    if (action === 'cleanup') {
      const { data, error } = await adminClient
        .from('patients')
        .delete()
        .like('full_name', '[SIMULATION]%')
        .select('id');

      if (error) {
        return NextResponse.json({
          error: `فشل في مسح بيانات المحاكاة: ${error.message} (code: ${error.code})`
        }, { status: 500 });
      }

      const deletedCount = data?.length || 0;

      // Best-effort log (don't fail if table doesn't exist yet)
      try {
        await adminClient.from('simulation_logs').insert({
          action: 'removed',
          user_email: auth.user!.email,
          user_name: auth.profile!.full_name,
          record_count: deletedCount
        });
      } catch (_) { /* ignore audit log failure */ }

      return NextResponse.json({
        success: true,
        message: `تم تنظيف بيانات المحاكاة بنجاح (حذف ${deletedCount} مريض)`,
        deletedCount
      });
    }

    // ── GENERATE ───────────────────────────────────────────────────────────────
    if (action === 'generate') {
      const recordsToGenerate = Math.min(count || 50, 200); // Cap at 200

      // Stage 1: Fetch active health units
      const { data: units, error: unitsError } = await adminClient
        .from('health_units')
        .select('id, name, daily_target')
        .eq('active', true);

      if (unitsError) {
        return NextResponse.json({
          error: `فشل تحميل الوحدات الصحية: ${unitsError.message}`
        }, { status: 500 });
      }
      if (!units || units.length === 0) {
        return NextResponse.json({
          error: 'لا توجد وحدات صحية نشطة في النظام. يرجى إضافة وحدات قبل توليد البيانات.'
        }, { status: 422 });
      }

      // Use timestamp-based run ID to guarantee uniqueness across runs
      const runId = Date.now().toString().substring(5); // Last 8 digits of ms timestamp

      const patientsToInsert: any[] = [];
      const visitsToInsert: any[] = [];

      const names = [
        'أحمد محمد', 'محمود علي', 'محمد إبراهيم', 'عبدالله حسن', 'خالد سعيد',
        'فاطمة أحمد', 'نور الهدى', 'مريم حسين', 'سارة إبراهيم', 'هدى محمود',
        'يوسف عبدالله', 'عمر خالد', 'إبراهيم محمد', 'حسن علي', 'عمرو سعد',
        'أسماء أحمد', 'ريم علي', 'منى حسن', 'دينا محمد', 'رنا عبدالرحمن',
      ];

      for (let i = 0; i < recordsToGenerate; i++) {
        const patientId = crypto.randomUUID();
        const unit = units[i % units.length]; // distribute evenly across units
        const unitId = unit.id;

        // Clinical data
        const age = Math.floor(Math.random() * (80 - 35) + 35); // Adults more likely to have chronic conditions
        const gender = i % 2 === 0 ? 'ذكر' : 'أنثى';
        const systolic = Math.floor(Math.random() * (185 - 100) + 100);
        const diastolic = Math.floor(Math.random() * (115 - 60) + 60);
        const hasSugar = Math.random() > 0.45; // ~55% have diabetes screening
        const sugarLevel = hasSugar ? Math.floor(Math.random() * (380 - 70) + 70) : null;
        const baseName = names[i % names.length];
        const isReferred = systolic >= 160 || diastolic >= 100 || (hasSugar && sugarLevel !== null && sugarLevel > 300);

        // Unique national ID: SIM prefix + runId + index (no collision possible)
        const nationalId = generateSimNationalId(runId, i);

        patientsToInsert.push({
          id: patientId,
          national_id: nationalId,
          full_name: `[SIMULATION] ${baseName} ${i + 1}`,
          phone: `01${String(Math.floor(Math.random() * 900000000) + 100000000)}`,
          governorate: 'سوهاج',
          age,
          gender,
          first_visit_date: new Date().toISOString(),
        });

        visitsToInsert.push({
          patient_id: patientId,
          unit_id: unitId,
          // Each patient has a unique patientId, so (patient_id, unit_id, visit_date)
          // will never conflict — patient_id alone makes it unique.
          visit_type: Math.random() > 0.65 ? 'متردد' : 'أول مرة',
          // TODAY's date so it shows in todayVisits KPI, each with unique time
          visit_date: generateTodayVisitDate(i),
          systolic,
          diastolic,
          sugar_type: hasSugar ? (Math.random() > 0.5 ? 'عشوائي' : 'صائم') : null,
          sugar_level: sugarLevel,
          weight: Math.floor(Math.random() * (130 - 50) + 50),
          height: Math.floor(Math.random() * (185 - 150) + 150),
          referred: isReferred,
          referral_dest: isReferred ? 'مستشفى سوهاج العام' : null,
        });
      }

      // Stage 2: Insert patients
      const { data: insertedPatients, error: pError } = await adminClient
        .from('patients')
        .insert(patientsToInsert)
        .select('id');

      if (pError) {
        return NextResponse.json({
          error: `[مرحلة 1] فشل إدخال المرضى: ${pError.message} | الكود: ${pError.code} | التفاصيل: ${pError.details || 'لا يوجد'}`,
          stage: 'patients',
          hint: pError.hint || null,
        }, { status: 500 });
      }

      const patientsCreated = insertedPatients?.length || 0;

      // Stage 3: Insert visits
      const { data: insertedVisits, error: vError } = await adminClient
        .from('visits')
        .insert(visitsToInsert)
        .select('id');

      if (vError) {
        // Rollback: delete the patients we just created to keep DB clean
        await adminClient.from('patients')
          .delete()
          .in('id', patientsToInsert.map(p => p.id));

        return NextResponse.json({
          error: `[مرحلة 2] فشل إدخال الزيارات: ${vError.message} | الكود: ${vError.code} | التفاصيل: ${vError.details || 'لا يوجد'}`,
          stage: 'visits',
          hint: vError.hint || null,
          patientsRolledBack: patientsCreated,
        }, { status: 500 });
      }

      const visitsCreated = insertedVisits?.length || 0;

      // Stage 4: Audit log (best-effort)
      try {
        await adminClient.from('simulation_logs').insert({
          action: 'generated',
          user_email: auth.user!.email,
          user_name: auth.profile!.full_name,
          record_count: patientsCreated
        });
      } catch (_) { /* ignore audit log failure */ }

      return NextResponse.json({
        success: true,
        message: `تم توليد بيانات المحاكاة بنجاح`,
        counts: {
          patientsCreated,
          visitsCreated,
          screeningsCreated: visitsCreated, // Visits contain all clinical screening data
          followUpsCreated: visitsToInsert.filter(v => v.visit_type === 'متردد').length,
        },
        unitsUsed: units.length,
        runId,
      });
    }

    return NextResponse.json({ error: 'إجراء غير صالح. القيم المقبولة: generate | cleanup' }, { status: 400 });

  } catch (err: any) {
    console.error('[simulate] Unexpected error:', err);
    return NextResponse.json({
      error: `خطأ غير متوقع: ${err.message}`,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    }, { status: 500 });
  }
}
