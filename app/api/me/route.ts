import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server-admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "غير مصرح — يجب تسجيل الدخول" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error } = await adminClient
      .from("users")
      .select("id, full_name, username, phone, email, role, department_id, unit_id, active, must_change_password, created_at, updated_at")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: "لم يتم العثور على ملف المستخدم" }, { status: 404 });
    }

    if (!profile.active) {
      return NextResponse.json({ error: "هذا الحساب تم إيقافه من قبل المسؤول" }, { status: 403 });
    }

    return NextResponse.json(profile);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
