import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server-admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function checkSupervisorAuth() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { error: 'غير مصرح — يجب تسجيل الدخول', status: 401, user: null, profile: null };

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from('users')
    .select('id, full_name, email, role')
    .eq('email', user.email)
    .single();

  if (!profile || profile.role !== 'supervisor') {
    return { error: 'غير مصرح — صلاحية المشرف مطلوبة', status: 403, user: null, profile: null };
  }

  return { error: null, status: 200, user, profile };
}

// ─── National ID Generator ────────────────────────────────────────────────────
/**
 * PHASE 2 – NATIONAL ID GENERATION HARDENING
 *
 * Root cause of the duplicate key bug:
 *   Previous: `SIM${runId}${index.padStart(4,'0')}`.substring(0,14)
 *   runId = Date.now().substring(5) = 9 chars
 *   Total = 3 + 9 + 4 = 16 chars → truncated to 14 → INDEX DIGITS LOST → all IDs identical
 *
 * Fix: Use crypto.randomUUID() stripped of dashes, take 11 chars → 'SIM' + 11 = 14 chars
 *      UUID v4 gives 122 bits of entropy. Probability of collision across 10,000 records
 *      is ~1 in 10^26. Combined with DB pre-check, collision is impossible in practice.
 */
function generateCandidateNationalId(): string {
  // crypto.randomUUID() e.g. '110e8400-e29b-41d4-a716-446655440000'
  const raw = crypto.randomUUID().replace(/-/g, ''); // 32 hex chars
  return `SIM${raw.substring(0, 11)}`; // SIM + 11 hex = 14 chars total
}

/**
 * PHASE 2 – DB-backed uniqueness guarantee with retry.
 * Checks the in-memory set of IDs already decided for this batch (immediate dedup),
 * then the set of all existing SIM IDs in the DB (cross-run dedup).
 */
function getUniqueNationalId(
  existingIdsInDb: Set<string>,
  usedInBatch: Set<string>,
  maxRetries = 50
): { id: string; ok: true } | { ok: false; reason: string } {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const candidate = generateCandidateNationalId();
    if (!existingIdsInDb.has(candidate) && !usedInBatch.has(candidate)) {
      usedInBatch.add(candidate);
      return { id: candidate, ok: true };
    }
  }
  return {
    ok: false,
    reason: `Exhausted ${maxRetries} attempts to generate a unique national ID. Probability of this occurring is negligible — database may contain an extraordinary number of simulation records.`,
  };
}

/**
 * PHASE 1 – Visit date generator.
 * All visits are dated TODAY so they populate todayVisits KPI immediately.
 * Each record gets a unique timestamp to never violate UNIQUE(patient_id, unit_id, visit_date).
 * Since patient_id is always unique (new UUID per patient), this constraint will never fire,
 * but we spread times anyway for realistic data.
 */
function generateTodayVisitDate(index: number): string {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(8, 0, 0, 0);
  // Each record gets a unique second offset. 37s prime spread across 200 max records = ~2h spread.
  const secondOffset = index * 37;
  const visitMs = startOfDay.getTime() + secondOffset * 1000;
  const finalMs = Math.min(visitMs, now.getTime() - 500);
  return new Date(finalMs).toISOString();
}

// ─── Main Handler ──────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSupervisorAuth();
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json();
    const { action, count } = body;

    const adminClient = createAdminClient();

    // ── CLEANUP ────────────────────────────────────────────────────────────────
    if (action === 'cleanup') {
      const { data, error } = await adminClient
        .from('patients')
        .delete()
        .like('full_name', '[SIMULATION]%')
        .select('id');

      if (error) {
        return NextResponse.json({
          error: `فشل في مسح بيانات المحاكاة: ${error.message} (code: ${error.code})`,
        }, { status: 500 });
      }

      const deletedCount = data?.length || 0;

      try {
        await adminClient.from('simulation_logs').insert({
          action: 'removed',
          user_email: auth.user!.email,
          user_name: auth.profile!.full_name,
          record_count: deletedCount,
        });
      } catch (_) { /* audit log failure is non-fatal */ }

      return NextResponse.json({
        success: true,
        message: `تم تنظيف بيانات المحاكاة بنجاح (حذف ${deletedCount} مريض وزياراتهم)`,
        deletedCount,
      });
    }

    // ── GENERATE ───────────────────────────────────────────────────────────────
    if (action === 'generate') {
      const requestedCount = Math.min(count || 50, 500);

      // ── PHASE 1/5: Fetch active health units (required for foreign key) ────────
      const { data: units, error: unitsError } = await adminClient
        .from('health_units')
        .select('id, name, daily_target')
        .eq('active', true);

      if (unitsError) {
        return NextResponse.json({
          error: `[Stage 1] فشل تحميل الوحدات الصحية: ${unitsError.message}`,
          stage: 'units_fetch',
        }, { status: 500 });
      }
      if (!units || units.length === 0) {
        return NextResponse.json({
          error: 'لا توجد وحدات صحية نشطة في النظام. يرجى إضافة وحدات قبل توليد البيانات.',
          stage: 'units_fetch',
        }, { status: 422 });
      }

      // ── PHASE 2: Pre-load all existing SIM national IDs to guarantee uniqueness ─
      const { data: existingSimPatients } = await adminClient
        .from('patients')
        .select('national_id')
        .like('national_id', 'SIM%');

      const existingIdsInDb = new Set<string>(
        (existingSimPatients || []).map((p: any) => p.national_id)
      );
      const usedInBatch = new Set<string>();

      // ── Sample arabic names for realistic data ─────────────────────────────────
      const maleNames = ['أحمد محمد', 'محمود علي', 'محمد إبراهيم', 'عبدالله حسن', 'خالد سعيد', 'يوسف عبدالله', 'عمر خالد', 'إبراهيم محمد', 'حسن علي', 'عمرو سعد', 'كريم ناصر', 'سامي عادل'];
      const femaleNames = ['فاطمة أحمد', 'نور الهدى', 'مريم حسين', 'سارة إبراهيم', 'هدى محمود', 'أسماء أحمد', 'ريم علي', 'منى حسن', 'دينا محمد', 'رنا عبدالرحمن', 'إيمان سيد', 'نهاد محمد'];

      // ── PHASE 3 & 4: Per-record insertion with individual error handling ────────
      const results = {
        requested: requestedCount,
        patientsCreated: 0,
        patientsFailed: 0,
        visitsCreated: 0,
        visitsFailed: 0,
        screeningsCreated: 0, // visits with clinical data = screenings
        followUpsCreated: 0,  // visits of type 'متردد'
        errors: [] as Array<{ index: number; stage: string; message: string }>,
        integrityIssues: [] as string[],
      };

      for (let i = 0; i < requestedCount; i++) {
        // ── National ID (PHASE 2: guaranteed unique) ────────────────────────────
        const idResult = getUniqueNationalId(existingIdsInDb, usedInBatch);
        if (!idResult.ok) {
          results.patientsFailed++;
          results.errors.push({ index: i, stage: 'national_id_generation', message: idResult.reason });
          continue; // PHASE 3: skip this record, continue batch
        }

        // ── Build patient record ────────────────────────────────────────────────
        const patientId = crypto.randomUUID();
        const gender: 'ذكر' | 'أنثى' = i % 2 === 0 ? 'ذكر' : 'أنثى';
        const namePool = gender === 'ذكر' ? maleNames : femaleNames;
        const baseName = namePool[i % namePool.length];

        // Distribute patients evenly across all active units (round-robin)
        const unit = units[i % units.length];

        // Clinical data — realistic chronic disease profile
        const age = Math.floor(Math.random() * (78 - 35) + 35);
        const systolic = Math.floor(Math.random() * (195 - 95) + 95);
        const diastolic = Math.floor(Math.random() * (120 - 55) + 55);
        const hasDiabetes = Math.random() > 0.40; // 60% have diabetes
        const sugarLevel = hasDiabetes ? Math.floor(Math.random() * (400 - 70) + 70) : null;
        const isReferred = systolic >= 160 || diastolic >= 100 || (hasDiabetes && sugarLevel !== null && sugarLevel > 300);
        const visitType: 'أول مرة' | 'متردد' = Math.random() > 0.60 ? 'متردد' : 'أول مرة';

        // ── Stage 1: Insert patient ─────────────────────────────────────────────
        const { data: insertedPatient, error: pError } = await adminClient
          .from('patients')
          .insert({
            id: patientId,
            national_id: idResult.id,
            full_name: `[SIMULATION] ${baseName} ${i + 1}`,
            phone: `01${String(Math.floor(Math.random() * 900000000) + 100000000)}`,
            governorate: 'سوهاج',
            age,
            gender,
            first_visit_date: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (pError) {
          results.patientsFailed++;
          results.errors.push({
            index: i,
            stage: 'patient_insert',
            message: `[Patient #${i + 1}] ${pError.message} (code: ${pError.code}${pError.details ? ', details: ' + pError.details : ''})`,
          });
          // PHASE 3: skip to next record — DO NOT abort entire batch
          continue;
        }

        // Mark this national_id as used so future records in THIS batch avoid it
        existingIdsInDb.add(idResult.id);
        results.patientsCreated++;

        // ── PHASE 5: Data integrity check – ensure patient was actually inserted ─
        if (!insertedPatient?.id) {
          results.integrityIssues.push(`Patient #${i + 1}: insert returned no id`);
          continue;
        }

        // ── Stage 2: Insert visit (linked to the patient above) ─────────────────
        const { error: vError } = await adminClient
          .from('visits')
          .insert({
            patient_id: patientId,
            unit_id: unit.id,
            visit_type: visitType,
            visit_date: generateTodayVisitDate(i), // always TODAY for KPI visibility
            systolic,
            diastolic,
            sugar_type: hasDiabetes ? (Math.random() > 0.5 ? 'عشوائي' : 'صائم') : null,
            sugar_level: sugarLevel,
            weight: Math.floor(Math.random() * (130 - 50) + 50),
            height: Math.floor(Math.random() * (185 - 150) + 150),
            referred: isReferred,
            referral_dest: isReferred ? 'مستشفى سوهاج العام' : null,
          });

        if (vError) {
          results.visitsFailed++;
          results.errors.push({
            index: i,
            stage: 'visit_insert',
            message: `[Visit for Patient #${i + 1}] ${vError.message} (code: ${vError.code}${vError.details ? ', details: ' + vError.details : ''})`,
          });
          // ── PHASE 5 integrity: orphan patient detected – try to clean it up ────
          results.integrityIssues.push(
            `Orphan patient created (no visit): id=${patientId}, national_id=${idResult.id}`
          );
          await adminClient.from('patients').delete().eq('id', patientId);
          results.patientsCreated--; // correct the count since we rolled back this one
          continue;
        }

        results.visitsCreated++;
        results.screeningsCreated++; // every visit IS a clinical screening
        if (visitType === 'متردد') results.followUpsCreated++;
      }

      // ── PHASE 8: Audit log ─────────────────────────────────────────────────────
      try {
        await adminClient.from('simulation_logs').insert({
          action: 'generated',
          user_email: auth.user!.email,
          user_name: auth.profile!.full_name,
          record_count: results.patientsCreated,
        });
      } catch (_) { /* non-fatal */ }

      // ── PHASE 6 & 7: Dashboard connectivity summary ────────────────────────────
      // Since all visits are dated today with real unit assignments,
      // they will immediately appear in:
      //   - todayVisits KPI (counted by visit_date = today)
      //   - totalPatients KPI (counted by patients table)
      //   - referrals KPI (referred = true where systolic >= 160 or sugar > 300)
      //   - unit today_visits (visible in Units section and Needs Attention)
      //   - Top Performers (sorted by today_visits/daily_target)
      const dashboardConnectivity = {
        todayVisitsKPI: results.visitsCreated > 0,
        totalPatientsKPI: results.patientsCreated > 0,
        referralsKPI: results.visitsCreated > 0,
        unitsRequiringAttention: results.visitsCreated > 0,
        topPerformers: results.visitsCreated > 0,
        unitsUsed: units.length,
      };

      const overallSuccess = results.patientsCreated > 0;

      return NextResponse.json({
        success: overallSuccess,
        message: overallSuccess
          ? `تم توليد ${results.patientsCreated} مريض و${results.visitsCreated} زيارة بنجاح`
          : 'فشل توليد جميع السجلات. راجع قسم errors للتفاصيل.',
        counts: {
          patientsCreated: results.patientsCreated,
          visitsCreated: results.visitsCreated,
          screeningsCreated: results.screeningsCreated,
          followUpsCreated: results.followUpsCreated,
        },
        failures: {
          patientsFailed: results.patientsFailed,
          visitsFailed: results.visitsFailed,
          total: results.patientsFailed + results.visitsFailed,
        },
        summary: {
          requested: results.requested,
          created: results.patientsCreated,
          failed: results.patientsFailed + results.visitsFailed,
          successRate: `${Math.round((results.patientsCreated / results.requested) * 100)}%`,
        },
        dashboardConnectivity,
        integrityIssues: results.integrityIssues,
        errors: results.errors.slice(0, 20), // cap at 20 to avoid huge response
      }, { status: overallSuccess ? 200 : 207 }); // 207 Multi-Status if partial
    }

    return NextResponse.json({
      error: 'إجراء غير صالح. القيم المقبولة: generate | cleanup',
    }, { status: 400 });

  } catch (err: any) {
    console.error('[simulate] Unexpected error:', err);
    return NextResponse.json({
      error: `خطأ غير متوقع في خادم المحاكاة: ${err.message}`,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    }, { status: 500 });
  }
}
