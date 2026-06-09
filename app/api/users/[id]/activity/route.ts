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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await getCallerProfile();
    if (!profile || profile.role !== "supervisor" || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "معرف المستخدم مطلوب" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Get User base info
    const { data: user, error: userError } = await adminClient
      .from("users")
      .select("created_at, updated_at, last_login")
      .eq("id", id)
      .single();

    if (userError) throw new Error(userError.message);

    // 2. Get Last Recorded Visit
    const { data: lastVisit } = await adminClient
      .from("visits")
      .select("created_at, patients(full_name)")
      .eq("created_by", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // 3. Get Modification History from audit_logs
    const { data: auditLogs } = await adminClient
      .from("audit_logs")
      .select("*, performed_by_user:users!performed_by(full_name)")
      .eq("entity_id", id)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      accountCreationDate: user.created_at,
      lastLogin: user.last_login,
      lastProfileUpdate: user.updated_at,
      lastRecordedVisit: lastVisit || null,
      modificationHistory: auditLogs || []
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
