import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * GET /api/exports/patients
 * Returns all visit records with full patient & unit details,
 * grouped by department, for export purposes.
 * Access: supervisor only.
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Auth
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح — يجب تسجيل الدخول' }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
      .from('users')
      .select('id, role, department_id')
      .eq('email', user.email)
      .single();

    if (!profile || (profile.role !== 'supervisor' && profile.role !== 'coordinator')) {
      return NextResponse.json({ error: 'غير مصرح — صلاحية المشرف أو المنسق مطلوبة' }, { status: 403 });
    }

    // 2. Build query — visits with patient + unit + department
    let query = adminClient
      .from('visits')
      .select(`
        id,
        visit_type,
        visit_date,
        weight,
        height,
        sugar_type,
        sugar_level,
        hba1c,
        systolic,
        diastolic,
        cholesterol,
        triglycerides,
        ldl,
        hdl,
        creatinine,
        egfr,
        referred,
        referral_dest,
        created_at,
        patients (
          national_id,
          full_name,
          phone,
          age,
          gender,
          governorate
        ),
        health_units!inner (
          name,
          code,
          department_id,
          departments!inner (
            name
          )
        )
      `)
      .order('visit_date', { ascending: false });

    // Coordinator scope: limit to their department
    if (profile.role === 'coordinator' && profile.department_id) {
      query = query.eq('health_units.department_id', profile.department_id);
    }

    // Fetch all (no limit for exports — we need everything)
    const { data: visits, error } = await query;

    if (error) {
      console.error('Export patients query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 3. Group by department
    const grouped: Record<string, {
      department_name: string;
      records: any[];
      totals: { total: number; new_patients: number; returning: number; referred: number };
    }> = {};

    (visits || []).forEach((v: any) => {
      const deptName = v.health_units?.departments?.name || 'غير محدد';
      if (!grouped[deptName]) {
        grouped[deptName] = {
          department_name: deptName,
          records: [],
          totals: { total: 0, new_patients: 0, returning: 0, referred: 0 },
        };
      }
      grouped[deptName].records.push(v);
      grouped[deptName].totals.total++;
      if (v.visit_type === 'أول مرة') grouped[deptName].totals.new_patients++;
      if (v.visit_type === 'متردد') grouped[deptName].totals.returning++;
      if (v.referred) grouped[deptName].totals.referred++;
    });

    // Grand totals
    const grandTotals = {
      total: (visits || []).length,
      new_patients: (visits || []).filter((v: any) => v.visit_type === 'أول مرة').length,
      returning: (visits || []).filter((v: any) => v.visit_type === 'متردد').length,
      referred: (visits || []).filter((v: any) => v.referred).length,
    };

    return NextResponse.json({
      departments: grouped,
      grandTotals,
      exportedAt: new Date().toISOString(),
      exportedBy: user.email,
    });
  } catch (err: any) {
    console.error('Export patients error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
