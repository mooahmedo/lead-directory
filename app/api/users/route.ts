import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server-admin";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

// Helper to check if request is from supervisor
async function getCallerProfile(request: NextRequest) {
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
    const profile = await getCallerProfile(request);
    if (!profile || profile.role !== "supervisor" || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const adminClient = createAdminClient();
    // Fetch users joined with department name and unit name
    const { data: users, error } = await adminClient
      .from("users")
      .select(`
        id,
        full_name,
        email,
        role,
        department_id,
        unit_id,
        active,
        created_at,
        departments(name),
        health_units(name)
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(users);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const profile = await getCallerProfile(request);
    if (!profile || profile.role !== "supervisor" || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const body = await request.json();
    const { email, password, fullName, role, departmentId, unitId } = body;

    if (!email || !password || !fullName || !role) {
      return NextResponse.json({ error: "جميع الحقول المطلوبة يجب إدخالها" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Create user in Supabase Auth via the Admin API
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
        department_id: departmentId || null,
        unit_id: unitId || null,
      },
    });

    if (authError || !authUser.user) {
      return NextResponse.json({ error: authError?.message || "فشل إنشاء الحساب" }, { status: 500 });
    }

    // Note: The database trigger handles copying the user to public.users.
    // Let's query the newly created user in public.users to return it.
    const { data: newUser } = await adminClient
      .from("users")
      .select(`
        id,
        full_name,
        email,
        role,
        department_id,
        unit_id,
        active,
        created_at,
        departments(name),
        health_units(name)
      `)
      .eq("id", authUser.user.id)
      .single();

    return NextResponse.json({ success: true, user: newUser });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const profile = await getCallerProfile(request);
    if (!profile || profile.role !== "supervisor" || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const body = await request.json();
    const { id, active, fullName, role, departmentId, unitId } = body;

    if (!id) {
      return NextResponse.json({ error: "معرف المستخدم مطلوب" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Update in auth.users metadata if name/role/unit changes
    const updateData: any = {};
    if (fullName || role || departmentId !== undefined || unitId !== undefined) {
      const { data: currentAuth } = await adminClient.auth.admin.getUserById(id);
      const currentMeta = currentAuth?.user?.user_metadata || {};
      
      updateData.user_metadata = {
        ...currentMeta,
        full_name: fullName || currentMeta.full_name,
        role: role || currentMeta.role,
        department_id: departmentId !== undefined ? (departmentId || null) : currentMeta.department_id,
        unit_id: unitId !== undefined ? (unitId || null) : currentMeta.unit_id,
      };
      
      await adminClient.auth.admin.updateUserById(id, updateData);
    }

    // 2. Update status and fields in public.users directly to ensure consistency
    const publicUpdate: any = {};
    if (active !== undefined) publicUpdate.active = active;
    if (fullName) publicUpdate.full_name = fullName;
    if (role) publicUpdate.role = role;
    if (departmentId !== undefined) publicUpdate.department_id = departmentId || null;
    if (unitId !== undefined) publicUpdate.unit_id = unitId || null;
    publicUpdate.updated_at = new Date().toISOString();

    const { error: publicError } = await adminClient
      .from("users")
      .update(publicUpdate)
      .eq("id", id);

    if (publicError) {
      return NextResponse.json({ error: publicError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
