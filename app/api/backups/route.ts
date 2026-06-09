import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Shared auth check: only supervisor role allowed for backup operations.
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
 * GET /api/backups — List all backup logs
 */
export async function GET() {
  try {
    const auth = await checkSupervisorAuth();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const adminClient = createAdminClient();
    const { data: logs, error } = await adminClient
      .from('backup_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ logs: logs || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/backups — Generate a backup (Excel + JSON).
 * Returns backup metadata. The actual file generation happens client-side.
 * This endpoint fetches all operational data that should be backed up.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSupervisorAuth();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const adminClient = createAdminClient();

    // Fetch all operational data in parallel
    const [
      patientsRes,
      visitsRes,
      unitsRes,
      departmentsRes,
      usersRes,
    ] = await Promise.all([
      adminClient.from('patients').select('*').order('created_at', { ascending: false }),
      adminClient.from('visits').select(`
        *,
        patients ( national_id, full_name, phone, age, gender, governorate ),
        health_units ( name, code, department_id, departments ( name ) )
      `).order('visit_date', { ascending: false }),
      adminClient.from('health_units').select('*, departments ( name )').order('name'),
      adminClient.from('departments').select('*').order('name'),
      adminClient.from('users').select('id, full_name, email, role, department_id, unit_id, active, created_at').order('created_at'),
    ]);

    const backupData = {
      metadata: {
        created_at: new Date().toISOString(),
        created_by: auth.profile!.full_name,
        created_by_email: auth.user!.email,
        version: '1.0',
      },
      patients: patientsRes.data || [],
      visits: visitsRes.data || [],
      health_units: unitsRes.data || [],
      departments: departmentsRes.data || [],
      users: usersRes.data || [],
      counts: {
        patients: (patientsRes.data || []).length,
        visits: (visitsRes.data || []).length,
        health_units: (unitsRes.data || []).length,
        departments: (departmentsRes.data || []).length,
        users: (usersRes.data || []).length,
      },
    };

    const totalRecords = backupData.counts.patients + backupData.counts.visits;

    // Log the backup creation
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    const fileName = `Backup_${timestamp}`;

    await adminClient.from('backup_logs').insert({
      backup_type: 'manual',
      file_name: fileName,
      user_email: auth.user!.email,
      user_name: auth.profile!.full_name,
      user_role: auth.profile!.role,
      record_count: totalRecords,
      file_size: 0, // Will be updated client-side if needed
      action: 'created',
    });

    return NextResponse.json({
      success: true,
      backup: backupData,
      fileName,
      totalRecords,
      message: 'تم إنشاء النسخة الاحتياطية بنجاح',
    });
  } catch (err: any) {
    console.error('Backup creation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
