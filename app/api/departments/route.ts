import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server-admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function getCallerProfile() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return null;

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("users")
    .select("id, role, active")
    .eq("id", user.id)
    .single();

  return profile;
}

export async function GET() {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("departments")
      .select("id, name, created_at, updated_at")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const profile = await getCallerProfile();
    if (!profile || profile.role !== "supervisor" || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "اسم الإدارة الصحية مطلوب" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { data: newDept, error } = await adminClient
      .from("departments")
      .insert({ name })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "هذه الإدارة مسجلة بالفعل" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, department: newDept });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
