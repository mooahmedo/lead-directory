import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Verify supervisor session
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'غير مصرح — يجب تسجيل الدخول' }, { status: 401 });
    }

    // Check user role
    const adminClient = createAdminClient();
    const { data: userProfile } = await adminClient
      .from('users')
      .select('role, department_id')
      .eq('email', user.email)
      .single();

    if (!userProfile || (userProfile.role !== 'supervisor' && userProfile.role !== 'coordinator')) {
      return NextResponse.json({ error: 'غير مصرح — صلاحية المشرف أو المنسق مطلوبة' }, { status: 403 });
    }

    let unitIds: string[] = [];
    if (userProfile.role === 'coordinator') {
      if (!userProfile.department_id) {
        return NextResponse.json({ error: 'غير مصرح — حساب المنسق غير مرتبط بإدارة' }, { status: 403 });
      }
      const { data: deptUnits } = await adminClient
        .from('health_units')
        .select('id')
        .eq('department_id', userProfile.department_id);
      
      unitIds = (deptUnits || []).map((u: any) => u.id);
      
      // If no units, we might still proceed but results will be 0
      if (unitIds.length === 0) {
        unitIds = ['00000000-0000-0000-0000-000000000000'];
      }
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.toISOString();
    const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // Get current month range
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    // Run all stats queries in parallel
    let totalPatientsQuery = adminClient.from('patients').select('id', { count: 'exact', head: true });
    let totalVisitsQuery = adminClient.from('visits').select('id', { count: 'exact', head: true });
    let todayVisitsQuery = adminClient.from('visits').select('id', { count: 'exact', head: true }).gte('visit_date', todayStart).lt('visit_date', todayEnd);
    let newPatientsQuery = adminClient.from('visits').select('id', { count: 'exact', head: true }).eq('visit_type', 'أول مرة');
    let returningQuery = adminClient.from('visits').select('id', { count: 'exact', head: true }).eq('visit_type', 'متردد');
    let referralsQuery = adminClient.from('visits').select('id', { count: 'exact', head: true }).eq('referred', true);
    let activeUnitsQuery = adminClient.from('health_units').select('id', { count: 'exact', head: true }).eq('active', true);
    let inactiveUnitsQuery = adminClient.from('health_units').select('id', { count: 'exact', head: true }).eq('active', false);
    let unitStatsQuery = adminClient.from('health_units').select(`
      id, code, name, department_id, daily_target, monthly_target, active,
      departments!inner(name)
    `).order('name');

    if (userProfile.role === 'coordinator') {
      totalVisitsQuery = totalVisitsQuery.in('unit_id', unitIds);
      todayVisitsQuery = todayVisitsQuery.in('unit_id', unitIds);
      newPatientsQuery = newPatientsQuery.in('unit_id', unitIds);
      returningQuery = returningQuery.in('unit_id', unitIds);
      referralsQuery = referralsQuery.in('unit_id', unitIds);
      
      activeUnitsQuery = activeUnitsQuery.eq('department_id', userProfile.department_id);
      inactiveUnitsQuery = inactiveUnitsQuery.eq('department_id', userProfile.department_id);
      unitStatsQuery = unitStatsQuery.eq('department_id', userProfile.department_id);
    }

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
      totalPatientsQuery,
      totalVisitsQuery,
      todayVisitsQuery,
      newPatientsQuery,
      returningQuery,
      referralsQuery,
      activeUnitsQuery,
      inactiveUnitsQuery,
      unitStatsQuery,
    ]);

    // Get today's visit counts per unit
    let todayUnitVisitsQuery = adminClient
      .from('visits')
      .select('unit_id')
      .gte('visit_date', todayStart)
      .lt('visit_date', todayEnd);

    // Get this month's visit counts per unit
    let monthUnitVisitsQuery = adminClient
      .from('visits')
      .select('unit_id')
      .gte('visit_date', monthStart);

    if (userProfile.role === 'coordinator') {
      todayUnitVisitsQuery = todayUnitVisitsQuery.in('unit_id', unitIds);
      monthUnitVisitsQuery = monthUnitVisitsQuery.in('unit_id', unitIds);
    }

    const { data: todayUnitVisits } = await todayUnitVisitsQuery;
    const { data: monthUnitVisits } = await monthUnitVisitsQuery;

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

    // Calculate real visits (excluding simulation data)
    let realTotalVisitsQuery = adminClient.from('visits').select('id, patients!inner(full_name)', { count: 'exact', head: true }).not('patients.full_name', 'like', '[SIMULATION]%');
    let realTodayVisitsQuery = adminClient.from('visits').select('id, patients!inner(full_name)', { count: 'exact', head: true }).not('patients.full_name', 'like', '[SIMULATION]%').gte('visit_date', todayStart).lt('visit_date', todayEnd);

    if (userProfile.role === 'coordinator') {
      realTotalVisitsQuery = realTotalVisitsQuery.in('unit_id', unitIds);
      realTodayVisitsQuery = realTodayVisitsQuery.in('unit_id', unitIds);
    }

    const { count: realTotalVisits } = await realTotalVisitsQuery;
    const { count: realTodayVisits } = await realTodayVisitsQuery;

    return NextResponse.json({
      stats: {
        totalPatients: userProfile.role === 'coordinator' ? (newPatientsRes.count || 0) : (totalPatientsRes.count || 0),
        totalVisits: totalVisitsRes.count || 0,
        todayVisits: todayVisitsRes.count || 0,
        realTotalVisits: realTotalVisits || 0,
        realTodayVisits: realTodayVisits || 0,
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
