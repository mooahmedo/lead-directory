import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";

/**
 * POST /api/auth/lookup-username
 * Given a username, returns the email associated with it.
 * This allows username-based login via Supabase (which requires email).
 */
export async function POST(request: NextRequest) {
  console.log("LOOKUP USERNAME ROUTE HIT!");
  try {
    const { username } = await request.json();

    if (!username) {
      return NextResponse.json({ error: "اسم المستخدم مطلوب" }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: user, error } = await adminClient
      .from("users")
      .select("email, active")
      .eq("username", username.trim().toLowerCase())
      .single();

    if (error || !user) {
      return NextResponse.json({ error: "اسم المستخدم غير موجود" }, { status: 404 });
    }

    if (!user.active) {
      return NextResponse.json({ error: "هذا الحساب موقوف. تواصل مع المسؤول" }, { status: 403 });
    }

    return NextResponse.json({ email: user.email });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
