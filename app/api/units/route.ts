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
    .select("id, role, active, department_id")
    .eq("id", user.id)
    .single();

  return profile;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let departmentId = searchParams.get("departmentId");
    const includeInactive = searchParams.get("includeInactive") === "true";

    const profile = await getCallerProfile();
    if (profile?.role === "coordinator") {
      departmentId = profile.department_id;
    }

    const supabase = createAdminClient();

    let query = supabase
      .from("health_units")
      .select("id, code, name, department_id, daily_target, monthly_target, active, created_at, updated_at")
      .order("name", { ascending: true });

    if (!includeInactive) {
      query = query.eq("active", true);
    }

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }

    const { data, error } = await query;

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
    if (!profile || (profile.role !== "supervisor" && profile.role !== "coordinator") || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف أو المنسق مطلوبة" }, { status: 403 });
    }

    const body = await request.json();
    let { code, name, departmentId, dailyTarget, monthlyTarget } = body;

    if (profile.role === "coordinator") {
      departmentId = profile.department_id;
    }

    if (!code || !name || !departmentId) {
      return NextResponse.json({ error: "كود الوحدة، الاسم، والقسم حقول مطلوبة" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { data: newUnit, error } = await adminClient
      .from("health_units")
      .insert({
        code,
        name,
        department_id: departmentId,
        daily_target: dailyTarget || 15,
        monthly_target: monthlyTarget || 300,
        active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, unit: newUnit });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const profile = await getCallerProfile();
    if (!profile || (profile.role !== "supervisor" && profile.role !== "coordinator") || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف أو المنسق مطلوبة" }, { status: 403 });
    }

    const body = await request.json();
    const { id, code, name, dailyTarget, monthlyTarget, active } = body;

    if (!id) {
      return NextResponse.json({ error: "معرف الوحدة الصحية مطلوب" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    if (profile.role === "coordinator") {
      const { data: existingUnit } = await adminClient.from("health_units").select("department_id").eq("id", id).single();
      if (!existingUnit || existingUnit.department_id !== profile.department_id) {
         return NextResponse.json({ error: "غير مصرح — الوحدة الصحية لا تتبع لإدارتك" }, { status: 403 });
      }
    }
    const updateData: any = {};
    if (code) updateData.code = code;
    if (name) updateData.name = name;
    if (dailyTarget !== undefined) updateData.daily_target = dailyTarget;
    if (monthlyTarget !== undefined) updateData.monthly_target = monthlyTarget;
    if (active !== undefined) updateData.active = active;
    updateData.updated_at = new Date().toISOString();

    const { data: updatedUnit, error } = await adminClient
      .from("health_units")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, unit: updatedUnit });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
