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
        setAll() {},
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

export async function POST(request: NextRequest) {
  try {
    const profile = await getCallerProfile(request);
    if (!profile || profile.role !== "supervisor" || !profile.active) {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const body = await request.json();
    const { userIds, action } = body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "يجب اختيار مستخدم واحد على الأقل" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    if (action === "activate" || action === "deactivate") {
      const activeState = action === "activate";
      const { error } = await adminClient
        .from("users")
        .update({ active: activeState, updated_at: new Date().toISOString() })
        .in("id", userIds);

      if (error) throw new Error(error.message);
      
      return NextResponse.json({ success: true, message: `تم ${activeState ? 'تفعيل' : 'تعطيل'} المستخدمين بنجاح` });
    }

    if (action === "reset_password") {
      const tempPass = "Temp@" + Math.random().toString(36).slice(2, 8);
      
      // Update each user in Auth
      for (const id of userIds) {
        await adminClient.auth.admin.updateUserById(id, {
          password: tempPass,
          user_metadata: { must_change_password: true }
        });
      }

      // Update in public.users to keep sync
      await adminClient
        .from("users")
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .in("id", userIds);

      return NextResponse.json({ 
        success: true, 
        message: "تم إعادة تعيين كلمات المرور بنجاح", 
        tempPassword: tempPass 
      });
    }

    return NextResponse.json({ error: "إجراء غير صالح" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
