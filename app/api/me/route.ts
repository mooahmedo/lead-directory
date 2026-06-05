import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server-admin";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {},
        },
      }
    );

    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "غير مصرح — يجب تسجيل الدخول" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error } = await adminClient
      .from("users")
      .select("id, full_name, email, role, department_id, unit_id, active, created_at, updated_at")
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
