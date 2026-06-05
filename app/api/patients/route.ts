import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server-admin";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

async function checkAuth(request: NextRequest) {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {},
      },
    }
  );

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

export async function GET(request: NextRequest) {
  try {
    const profile = await checkAuth(request);
    if (!profile || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — يجب تسجيل الدخول" }, { status: 401 });
    }

    if (profile.role !== "supervisor") {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");

    const adminClient = createAdminClient();
    let query = adminClient
      .from("patients")
      .select("id, national_id, full_name, phone, birth_date, age, gender, governorate, first_visit_date, active")
      .order("first_visit_date", { ascending: false });

    if (search) {
      // Search by national_id or full_name (fuzzy match)
      query = query.or(`national_id.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: patients, error } = await query.limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(patients);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
