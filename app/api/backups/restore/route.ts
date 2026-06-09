import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Shared auth check: only supervisor role allowed for restore operations.
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
 * POST /api/backups/restore
 * Restores operational data from a JSON backup payload.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSupervisorAuth();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json();
    const { backupData } = body;

    if (!backupData || !backupData.patients || !backupData.visits) {
      return NextResponse.json({ error: 'ملف النسخة الاحتياطية غير صالح أو تالف' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // The restore process using JSON backup:
    // 1. We must verify if the user typed the confirmation string on the frontend.
    // 2. Clear existing operational data (visits and patients) to prevent duplicates.
    // 3. Insert backed up data.
    // We only restore patients and visits to preserve units/departments.

    // Note: Due to foreign key constraints, deleting patients will cascade to visits.
    const { error: delError } = await adminClient.from('patients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delError) {
      console.error("Failed to clear current data:", delError);
      return NextResponse.json({ error: 'فشل في مسح البيانات الحالية قبل الاسترجاع' }, { status: 500 });
    }

    // Insert Patients
    if (backupData.patients.length > 0) {
      const { error: insPatientsError } = await adminClient.from('patients').insert(backupData.patients);
      if (insPatientsError) {
        console.error("Failed to restore patients:", insPatientsError);
        return NextResponse.json({ error: 'فشل استرجاع بيانات المرضى' }, { status: 500 });
      }
    }

    // Insert Visits
    // We strip joined fields from visits before insert (e.g. patients, health_units)
    const cleanVisits = backupData.visits.map((v: any) => {
      const { patients, health_units, ...rest } = v;
      return rest;
    });

    if (cleanVisits.length > 0) {
      const { error: insVisitsError } = await adminClient.from('visits').insert(cleanVisits);
      if (insVisitsError) {
        console.error("Failed to restore visits:", insVisitsError);
        return NextResponse.json({ error: 'فشل استرجاع سجلات الزيارات' }, { status: 500 });
      }
    }

    const totalRestored = backupData.patients.length + cleanVisits.length;

    // Log the restore operation
    await adminClient.from('backup_logs').insert({
      backup_type: 'json',
      file_name: backupData.metadata?.file_name || 'Restored_Backup',
      user_email: auth.user!.email,
      user_name: auth.profile!.full_name,
      user_role: auth.profile!.role,
      record_count: totalRestored,
      action: 'restored',
    });

    return NextResponse.json({
      success: true,
      message: 'تم استرجاع النسخة الاحتياطية بنجاح',
      restoredRecords: totalRestored
    });

  } catch (err: any) {
    console.error('Restore error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
