import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Shared auth check: only supervisor role allowed for reset operations.
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
 * POST /api/system/reset
 * Performs destructive system resets.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSupervisorAuth();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json();
    const { resetType, backupFile } = body;

    if (!['patient_data', 'operational_data'].includes(resetType)) {
      return NextResponse.json({ error: 'نوع العملية غير صالح' }, { status: 400 });
    }

    if (!backupFile) {
      return NextResponse.json({ error: 'يجب توفير اسم ملف النسخة الاحتياطية الذي تم إنشاؤه' }, { status: 400 });
    }

    const adminClient = createAdminClient();
    let recordsDeleted = 0;

    if (resetType === 'patient_data') {
      // 1. Delete all patients (cascades to visits automatically)
      const { data, error } = await adminClient.from('patients').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id');
      if (error) {
        return NextResponse.json({ error: 'فشل في مسح بيانات المرضى' }, { status: 500 });
      }
      recordsDeleted = data?.length || 0;
    } else if (resetType === 'operational_data') {
      // 1. Delete all patients (cascades to visits)
      const { data: pData, error: pError } = await adminClient.from('patients').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id');
      if (pError) {
        return NextResponse.json({ error: 'فشل في مسح بيانات المرضى' }, { status: 500 });
      }
      
      // 2. Delete all users except the current admin
      const { data: uData, error: uError } = await adminClient.from('users').delete().neq('id', auth.user!.id).select('id');
      if (uError) {
        return NextResponse.json({ error: 'فشل في مسح المستخدمين' }, { status: 500 });
      }
      
      // Note: We do NOT touch auth.users directly via SQL here as it requires Supabase Auth admin API.
      // The users table acts as the functional authorization layer.
      
      recordsDeleted = (pData?.length || 0) + (uData?.length || 0);
    }

    // Log the reset operation
    await adminClient.from('reset_logs').insert({
      reset_type: resetType,
      user_email: auth.user!.email,
      user_name: auth.profile!.full_name,
      user_role: auth.profile!.role,
      records_deleted: recordsDeleted,
      backup_file: backupFile,
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    });

    return NextResponse.json({
      success: true,
      message: 'تمت عملية المسح بنجاح',
      recordsDeleted
    });

  } catch (err: any) {
    console.error('Reset error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
