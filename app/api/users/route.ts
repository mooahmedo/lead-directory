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
        username,
        phone,
        email,
        role,
        department_id,
        unit_id,
        active,
        last_login,
        must_change_password,
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
    const { email, password, fullName, role, departmentId, unitId, username, phone } = body;

    if (!email || !password || !fullName || !role) {
      return NextResponse.json({ error: "جميع الحقول المطلوبة يجب إدخالها" }, { status: 400 });
    }

    // Validate username uniqueness if provided
    if (username) {
      const adminClient = createAdminClient();
      const { data: existing } = await adminClient
        .from("users")
        .select("id")
        .eq("username", username.trim().toLowerCase())
        .single();
      if (existing) {
        return NextResponse.json({ error: "اسم المستخدم مستخدم بالفعل. اختر اسماً آخر" }, { status: 409 });
      }
    }

    const adminClient = createAdminClient();

    // Create user in Supabase Auth via the Admin API
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username: username ? username.trim().toLowerCase() : null,
        phone: phone || null,
        role,
        department_id: departmentId || null,
        unit_id: unitId || null,
        must_change_password: true,
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
        username,
        phone,
        email,
        role,
        department_id,
        unit_id,
        active,
        last_login,
        must_change_password,
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
    const { id, active, fullName, email, password, username, phone, role, departmentId, unitId, mustChangePassword } = body;

    if (!id) {
      return NextResponse.json({ error: "معرف المستخدم مطلوب" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Update in auth.users metadata if name/role/unit changes
    const updateData: any = {};
    if (email) updateData.email = email;
    if (password) updateData.password = password;
    
    if (fullName || role || departmentId !== undefined || unitId !== undefined || username !== undefined || phone !== undefined) {
      const { data: currentAuth } = await adminClient.auth.admin.getUserById(id);
      const currentMeta = currentAuth?.user?.user_metadata || {};
      
      updateData.user_metadata = {
        ...currentMeta,
        full_name: fullName || currentMeta.full_name,
        username: username !== undefined ? (username ? username.trim().toLowerCase() : null) : currentMeta.username,
        phone: phone !== undefined ? (phone || null) : currentMeta.phone,
        role: role || currentMeta.role,
        department_id: departmentId !== undefined ? (departmentId || null) : currentMeta.department_id,
        unit_id: unitId !== undefined ? (unitId || null) : currentMeta.unit_id,
        must_change_password: mustChangePassword !== undefined ? mustChangePassword : currentMeta.must_change_password,
      };
    }
    
    if (Object.keys(updateData).length > 0) {
      const { error: authError } = await adminClient.auth.admin.updateUserById(id, updateData);
      if (authError) {
        // If the user doesn't exist in Auth, we can't update credentials. Return specific error.
        if (authError.message === "User not found" || authError.status === 404) {
          return NextResponse.json({ error: "حساب المستخدم معطوب (مفقود من نظام التوثيق). يرجى حذفه نهائياً." }, { status: 404 });
        }
        return NextResponse.json({ error: authError.message }, { status: 500 });
      }
    }

    // 2. Update status and fields in public.users directly to ensure consistency
    const publicUpdate: any = {};
    if (active !== undefined) publicUpdate.active = active;
    if (email) publicUpdate.email = email;
    if (fullName) publicUpdate.full_name = fullName;
    if (username !== undefined) publicUpdate.username = username ? username.trim().toLowerCase() : null;
    if (phone !== undefined) publicUpdate.phone = phone || null;
    if (role) publicUpdate.role = role;
    if (mustChangePassword !== undefined) publicUpdate.must_change_password = mustChangePassword;
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

export async function DELETE(request: NextRequest) {
  try {
    const profile = await getCallerProfile(request);
    if (!profile || profile.role !== "supervisor" || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("id");

    if (!userId) {
      return NextResponse.json({ error: "معرف المستخدم مطلوب" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Log the deletion to audit_logs before actually deleting the user
    // because deleting the user might drop foreign key ties if it cascades
    // or fail if it doesn't.
    const { data: targetUser } = await adminClient
      .from("users")
      .select("id, full_name, email, role")
      .eq("id", userId)
      .single();

    if (targetUser) {
      await adminClient.from("audit_logs").insert({
        action_type: "delete_user",
        entity_type: "users",
        entity_id: userId,
        performed_by: profile.id,
        details: {
          deleted_user_name: targetUser.full_name,
          deleted_user_email: targetUser.email,
          deleted_user_role: targetUser.role
        }
      });
    }

    // Delete the user from auth.users (which cascades/triggers deletion in public.users)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      // If the user is already missing from Auth, we ignore the error and proceed to delete from public.users
      if (deleteError.message !== "User not found" && deleteError.status !== 404) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }
    }

    // Direct delete from public.users as backup (if ON DELETE CASCADE is missing)
    await adminClient.from("users").delete().eq("id", userId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
