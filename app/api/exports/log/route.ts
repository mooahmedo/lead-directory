import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 1. Verify user session
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'غير مصرح — يجب تسجيل الدخول' }, { status: 401 });
    }

    // 2. Parse request body
    const body = await request.json();
    const { export_type } = body;

    if (!export_type || !['PDF', 'Excel'].includes(export_type)) {
      return NextResponse.json({ error: 'نوع التصدير غير صالح' }, { status: 400 });
    }

    // 3. Verify user role is supervisor
    const adminClient = createAdminClient();
    const { data: userProfile } = await adminClient
      .from('users')
      .select('full_name, role')
      .eq('email', user.email)
      .single();

    if (!userProfile || userProfile.role !== 'supervisor') {
      return NextResponse.json({ error: 'غير مصرح — صلاحية المشرف مطلوبة' }, { status: 403 });
    }

    // 4. Log the export operation
    const { error: insertError } = await adminClient
      .from('export_logs')
      .insert({
        user_email: user.email,
        user_name: userProfile.full_name,
        user_role: userProfile.role,
        export_type: export_type,
      });

    if (insertError) {
      console.error("Export logging failed:", insertError);
      return NextResponse.json({ error: 'فشل في تسجيل عملية التصدير' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'تم تسجيل عملية التصدير بنجاح' });
  } catch (err: any) {
    console.error("Export logging API error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
