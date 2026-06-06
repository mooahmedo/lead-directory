import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { parseNationalId } from '@/lib/national-id';
import type { VisitSubmission } from '@/lib/types';
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {},
        },
      }
    );

    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "غير مصرح — يجب تسجيل الدخول" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
      .from("users")
      .select("id, role, active, unit_id")
      .eq("id", user.id)
      .single();

    if (!profile || !profile.active) {
      return NextResponse.json({ error: "الحساب غير نشط أو غير موجود" }, { status: 403 });
    }

    if (profile.role !== "supervisor") {
      return NextResponse.json({ error: "غير مصرح — صلاحية المشرف مطلوبة" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    let unitId = searchParams.get("unitId");
    let departmentId = searchParams.get("departmentId");

    let query = adminClient
      .from("visits")
      .select(`
        *,
        patients (
          full_name,
          national_id,
          phone,
          age,
          gender
        ),
        health_units!inner (
          name,
          code,
          department_id
        )
      `)
      .order("visit_date", { ascending: false });

    if (unitId) {
      query = query.eq("unit_id", unitId);
    }

    if (departmentId) {
      query = query.eq("health_units.department_id", departmentId);
    }

    const { data: visits, error } = await query.limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter in JS if search parameter is present (fuzzy search on patient fields)
    let filteredVisits = visits || [];
    if (search) {
      const lowerSearch = search.toLowerCase();
      filteredVisits = filteredVisits.filter((v: any) => 
        v.patients?.full_name?.includes(lowerSearch) || 
        v.patients?.national_id?.includes(lowerSearch)
      );
    }

    return NextResponse.json(filteredVisits);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: VisitSubmission = await request.json();

    const {
      nationalId,
      fullName,
      phone,
      departmentId,
      unitId,
      weight,
      height,
      sugarType,
      sugarLevel,
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
      referralDest,
    } = body;

    // Validate required fields
    if (!nationalId || !fullName || !unitId) {
      return NextResponse.json(
        { error: 'الرقم القومي واسم المريض والوحدة الصحية مطلوبة' },
        { status: 400 }
      );
    }

    // Validate and parse national ID
    const idInfo = parseNationalId(nationalId);
    if (!idInfo.valid) {
      return NextResponse.json(
        { error: idInfo.error || 'الرقم القومي غير صحيح' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Check if patient already exists
    const { data: existingPatient } = await supabase
      .from('patients')
      .select('id, national_id')
      .eq('national_id', nationalId)
      .single();

    let patientId: string;
    let visitType: 'أول مرة' | 'متردد';

    if (existingPatient) {
      // Returning patient
      patientId = existingPatient.id;
      visitType = 'متردد';

      // Update patient info if needed
      await supabase
        .from('patients')
        .update({
          full_name: fullName,
          phone: phone || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', patientId);
    } else {
      // New patient — create record
      const { data: newPatient, error: patientError } = await supabase
        .from('patients')
        .insert({
          national_id: nationalId,
          full_name: fullName,
          phone: phone || null,
          birth_date: idInfo.birthDate,
          age: idInfo.age,
          gender: idInfo.gender,
          governorate: idInfo.governorate,
          first_visit_date: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (patientError || !newPatient) {
        return NextResponse.json(
          { error: 'فشل إنشاء سجل المريض: ' + (patientError?.message || 'خطأ غير معروف') },
          { status: 500 }
        );
      }

      patientId = newPatient.id;
      visitType = 'أول مرة';
    }

    // Create visit record
    const visitDate = new Date().toISOString();

    const { data: visit, error: visitError } = await supabase
      .from('visits')
      .insert({
        patient_id: patientId,
        unit_id: unitId,
        visit_type: visitType,
        visit_date: visitDate,
        weight: weight || null,
        height: height || null,
        sugar_type: sugarType || null,
        sugar_level: sugarLevel || null,
        hba1c: hba1c || null,
        systolic: systolic || null,
        diastolic: diastolic || null,
        cholesterol: cholesterol || null,
        triglycerides: triglycerides || null,
        ldl: ldl || null,
        hdl: hdl || null,
        creatinine: creatinine || null,
        egfr: egfr || null,
        referred: referred ?? false,
        referral_dest: referred ? (referralDest || null) : null,
      })
      .select('id')
      .single();

    if (visitError) {
      // Handle duplicate visit
      if (visitError.code === '23505') {
        return NextResponse.json(
          { error: 'تم تسجيل زيارة لهذا المريض في هذه الوحدة اليوم بالفعل' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: 'فشل تسجيل الزيارة: ' + visitError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      visitId: visit.id,
      patientId,
      visitType,
      message: visitType === 'أول مرة'
        ? 'تم تسجيل المريض الجديد والزيارة بنجاح'
        : 'تم تسجيل الزيارة للمريض المتردد بنجاح',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
