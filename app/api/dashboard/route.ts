import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Verify supervisor session
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            // read-only in GET
          },
        },
      }
    );

    const { data: { user } } = await supabaseAuth.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'غير مصرح — يجب تسجيل الدخول' }, { status: 401 });
    }

    // Check user role
    const adminClient = createAdminClient();
    const { data: userProfile } = await adminClient
      .from('users')
      .select('role')
      .eq('email', user.email)
      .single();

    if (!userProfile || userProfile.role !== 'supervisor') {
      return NextResponse.json({ error: 'غير مصرح — صلاحية المشرف مطلوبة' }, { status: 403 });
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.toISOString();
    const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // Get current month range
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    // Run all stats queries in parallel
    const [
      totalPatientsRes,
      totalVisitsRes,
      todayVisitsRes,
      newPatientsRes,
      returningRes,
      referralsRes,
      activeUnitsRes,
      inactiveUnitsRes,
      unitStatsRes,
    ] = await Promise.all([
      adminClient.from('patients').select('id', { count: 'exact', head: true }),
      adminClient.from('visits').select('id', { count: 'exact', head: true }),
      adminClient.from('visits').select('id', { count: 'exact', head: true })
        .gte('visit_date', todayStart).lt('visit_date', todayEnd),
      adminClient.from('visits').select('id', { count: 'exact', head: true })
        .eq('visit_type', 'أول مرة'),
      adminClient.from('visits').select('id', { count: 'exact', head: true })
        .eq('visit_type', 'متردد'),
      adminClient.from('visits').select('id', { count: 'exact', head: true })
        .eq('referred', true),
      adminClient.from('health_units').select('id', { count: 'exact', head: true })
        .eq('active', true),
      adminClient.from('health_units').select('id', { count: 'exact', head: true })
        .eq('active', false),
      // Unit stats with department info and today's visit counts
      adminClient.from('health_units')
        .select(`
          id, code, name, department_id, daily_target, monthly_target, active,
          departments!inner(name)
        `)
        .order('name'),
    ]);

    // Get today's visit counts per unit
    const { data: todayUnitVisits } = await adminClient
      .from('visits')
      .select('unit_id')
      .gte('visit_date', todayStart)
      .lt('visit_date', todayEnd);

    // Get this month's visit counts per unit
    const { data: monthUnitVisits } = await adminClient
      .from('visits')
      .select('unit_id')
      .gte('visit_date', monthStart);

    // Build unit visit count maps
    const todayUnitMap: Record<string, number> = {};
    const monthUnitMap: Record<string, number> = {};

    (todayUnitVisits || []).forEach(v => {
      todayUnitMap[v.unit_id] = (todayUnitMap[v.unit_id] || 0) + 1;
    });
    (monthUnitVisits || []).forEach(v => {
      monthUnitMap[v.unit_id] = (monthUnitMap[v.unit_id] || 0) + 1;
    });

    const units = (unitStatsRes.data || []).map((u: any) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      department_id: u.department_id,
      department_name: u.departments?.name || '',
      daily_target: u.daily_target,
      monthly_target: u.monthly_target,
      active: u.active,
      today_visits: todayUnitMap[u.id] || 0,
      month_visits: monthUnitMap[u.id] || 0,
    }));

    return NextResponse.json({
      stats: {
        totalPatients: totalPatientsRes.count || 0,
        totalVisits: totalVisitsRes.count || 0,
        todayVisits: todayVisitsRes.count || 0,
        activeUnits: activeUnitsRes.count || 0,
        newPatients: newPatientsRes.count || 0,
        returningPatients: returningRes.count || 0,
        referrals: referralsRes.count || 0,
        inactiveUnits: inactiveUnitsRes.count || 0,
      },
      units,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
