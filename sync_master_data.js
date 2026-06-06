/**
 * ═══════════════════════════════════════════════════════════
 * Chronic Disease Initiative — Master Data Synchronization
 * ═══════════════════════════════════════════════════════════
 * Single source of truth: chronic_disease_units (2).json
 *
 * Operations performed:
 *   1. Generate a pre-sync report (additions, deletions, duplicates)
 *   2. Execute synchronization
 *   3. Generate a final validation report
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ── Read .env ──────────────────────────────────────────────
const envFile = fs.readFileSync('.env', 'utf8');
const env = envFile.split('\n').reduce((acc, line) => {
  const eqIdx = line.indexOf('=');
  if (eqIdx > 0) acc[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
  return acc;
}, {});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Load JSON source of truth ──────────────────────────────
const JSON_PATH = 'C:\\Users\\pc\\Downloads\\chronic_disease_units (2).json';
const rawJson = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

// Normalise: trim whitespace, collapse multiple spaces
const normalize = (s) => s.replace(/\s+/g, ' ').trim();

// Build clean map: deptName -> Set<unitName>
const JSON_DEPTS = {}; // deptName (normalized) -> original deptName
const JSON_UNITS = {}; // deptName -> [unit names normalized]

for (const [dept, units] of Object.entries(rawJson)) {
  const deptN = normalize(dept);
  JSON_DEPTS[deptN] = deptN;
  JSON_UNITS[deptN] = [...new Set(units.map(normalize))]; // deduplicate within JSON
}

// ── Per-department daily targets (from approved master data) ──
const DEPT_TARGETS = {
  'سوهاج':      { daily: 3,  monthly: 66 },
  'المنشاة':    { daily: 3,  monthly: 66 },
  'البلينا':    { daily: 3,  monthly: 66 },
  'جرجا':       { daily: 2,  monthly: 44 },
  'اخميم':      { daily: 4,  monthly: 88 },
  'طما':        { daily: 2,  monthly: 44 },
  'طهطا':       { daily: 3,  monthly: 66 },
  'المراغة':    { daily: 2,  monthly: 44 },
  'دار السلام': { daily: 3,  monthly: 66 },
  'جهينة':      { daily: 3,  monthly: 66 },
  'ساقلتة':     { daily: 2,  monthly: 44 },
};

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function log(msg) { process.stdout.write(msg + '\n'); }
function hr(char = '═', n = 62) { log(char.repeat(n)); }
function section(title) { log(''); hr(); log(`  ${title}`); hr(); }

// ════════════════════════════════════════════════════════════
// STEP 1: FETCH CURRENT DATABASE STATE
// ════════════════════════════════════════════════════════════
async function fetchDbState() {
  const { data: depts, error: dErr } = await supabase.from('departments').select('*');
  if (dErr) throw new Error('Failed to fetch departments: ' + dErr.message);

  const { data: units, error: uErr } = await supabase.from('health_units').select('*');
  if (uErr) throw new Error('Failed to fetch health_units: ' + uErr.message);

  return { depts: depts || [], units: units || [] };
}

// ════════════════════════════════════════════════════════════
// STEP 2: ANALYSE DIFFERENCES
// ════════════════════════════════════════════════════════════
function analyse(dbState) {
  const { depts: dbDepts, units: dbUnits } = dbState;

  // ── Departments ──
  // Map: normalized name -> db record
  const dbDeptByName = new Map();
  for (const d of dbDepts) {
    const n = normalize(d.name);
    if (!dbDeptByName.has(n)) dbDeptByName.set(n, []);
    dbDeptByName.get(n).push(d);
  }

  // Detect duplicates in DB
  const duplicateDepts = [];
  for (const [name, records] of dbDeptByName) {
    if (records.length > 1) duplicateDepts.push({ name, records });
  }

  const jsonDeptNames  = new Set(Object.keys(JSON_DEPTS));
  const dbDeptNames    = new Set([...dbDeptByName.keys()]);

  const deptsToAdd    = [...jsonDeptNames].filter(n => !dbDeptNames.has(n));
  const deptsToDelete = [...dbDeptNames].filter(n => !jsonDeptNames.has(n));
  const deptMatches   = [...jsonDeptNames].filter(n => dbDeptNames.has(n));

  // Build dept id lookup for matched depts (use first record if multiple)
  const deptIdByName = {};
  for (const name of deptMatches) {
    deptIdByName[name] = dbDeptByName.get(name)[0].id;
  }

  // ── Health Units ──
  // Group DB units by department_id
  const dbDeptIdToName = new Map(dbDepts.map(d => [d.id, normalize(d.name)]));
  
  // Map: deptName -> unitName -> [db records]
  const dbUnitsByDept = {};
  for (const u of dbUnits) {
    const deptName = dbDeptIdToName.get(u.department_id) || '__unknown__';
    if (!dbUnitsByDept[deptName]) dbUnitsByDept[deptName] = new Map();
    const uName = normalize(u.name);
    if (!dbUnitsByDept[deptName].has(uName)) dbUnitsByDept[deptName].set(uName, []);
    dbUnitsByDept[deptName].get(uName).push(u);
  }

  const unitsToAdd    = [];
  const unitsToDelete = [];
  const duplicateUnits = [];

  // For each JSON dept, compare units
  for (const deptName of jsonDeptNames) {
    const jsonUnits = new Set(JSON_UNITS[deptName]);
    const dbUnitsMap = dbUnitsByDept[deptName] || new Map();
    const dbUnitNames = new Set(dbUnitsMap.keys());

    // Duplicates in this dept
    for (const [uName, records] of dbUnitsMap) {
      if (records.length > 1) duplicateUnits.push({ dept: deptName, name: uName, records });
    }

    // Units to add: in JSON but not in DB (for this dept)
    for (const uName of jsonUnits) {
      if (!dbUnitNames.has(uName)) {
        unitsToAdd.push({ dept: deptName, name: uName });
      }
    }

    // Units to delete: in DB but not in JSON (for this dept)
    for (const uName of dbUnitNames) {
      if (!jsonUnits.has(uName)) {
        const records = dbUnitsMap.get(uName);
        records.forEach(r => unitsToDelete.push({ dept: deptName, name: uName, id: r.id }));
      }
    }
  }

  // Units in DB belonging to depts that will be deleted (collect for cleanup)
  for (const deptName of deptsToDelete) {
    const dbUnitsMap = dbUnitsByDept[deptName] || new Map();
    for (const [uName, records] of dbUnitsMap) {
      records.forEach(r => unitsToDelete.push({ dept: deptName, name: uName, id: r.id }));
    }
  }

  return {
    deptsToAdd, deptsToDelete, deptMatches,
    duplicateDepts, duplicateUnits,
    unitsToAdd, unitsToDelete,
    dbDeptByName, deptIdByName,
    dbUnitsByDept,
  };
}

// ════════════════════════════════════════════════════════════
// STEP 3: PRINT PRE-SYNC REPORT
// ════════════════════════════════════════════════════════════
function printReport(analysis, dbState) {
  const {
    deptsToAdd, deptsToDelete, deptMatches,
    duplicateDepts, duplicateUnits,
    unitsToAdd, unitsToDelete,
  } = analysis;

  section('PRE-SYNC ANALYSIS REPORT');

  log(`📂 JSON Source : ${JSON_PATH}`);
  log(`📊 JSON Data   : ${Object.keys(JSON_DEPTS).length} administrations, ` +
      `${Object.values(JSON_UNITS).reduce((s, a) => s + a.length, 0)} health units`);
  log(`🗄️  DB Current  : ${dbState.depts.length} administrations, ${dbState.units.length} health units`);

  log('');
  log('━━━ 1. NEW ADMINISTRATIONS TO ADD (' + deptsToAdd.length + ') ━━━');
  if (deptsToAdd.length === 0) log('  ✅ None');
  else deptsToAdd.forEach(n => log(`  ➕ ${n}`));

  log('');
  log('━━━ 2. NEW HEALTH UNITS TO ADD (' + unitsToAdd.length + ') ━━━');
  if (unitsToAdd.length === 0) log('  ✅ None');
  else unitsToAdd.forEach(u => log(`  ➕ [${u.dept}] ${u.name}`));

  log('');
  log('━━━ 3. ADMINISTRATIONS TO DELETE (' + deptsToDelete.length + ') ━━━');
  if (deptsToDelete.length === 0) log('  ✅ None');
  else deptsToDelete.forEach(n => log(`  🗑️  ${n}`));

  log('');
  log('━━━ 4. HEALTH UNITS TO DELETE (' + unitsToDelete.length + ') ━━━');
  if (unitsToDelete.length === 0) log('  ✅ None');
  else unitsToDelete.forEach(u => log(`  🗑️  [${u.dept}] ${u.name}`));

  log('');
  log('━━━ 5. DUPLICATE ADMINISTRATIONS IN DB (' + duplicateDepts.length + ') ━━━');
  if (duplicateDepts.length === 0) log('  ✅ None');
  else duplicateDepts.forEach(d => log(`  ⚠️  "${d.name}" appears ${d.records.length}x`));

  log('');
  log('━━━ 6. DUPLICATE HEALTH UNITS IN DB (' + duplicateUnits.length + ') ━━━');
  if (duplicateUnits.length === 0) log('  ✅ None');
  else duplicateUnits.forEach(u =>
    log(`  ⚠️  [${u.dept}] "${u.name}" appears ${u.records.length}x`));

  log('');
  log('━━━ 7. MATCHED ADMINISTRATIONS (no change needed) (' + deptMatches.length + ') ━━━');
  deptMatches.forEach(n => log(`  ✔️  ${n}`));

  hr('-', 62);
  const totalChanges = deptsToAdd.length + deptsToDelete.length +
    unitsToAdd.length + unitsToDelete.length +
    duplicateDepts.reduce((s, d) => s + d.records.length - 1, 0) +
    duplicateUnits.reduce((s, u) => s + u.records.length - 1, 0);
  log(`📋 Total changes to apply: ${totalChanges}`);
}

// ════════════════════════════════════════════════════════════
// STEP 4: EXECUTE SYNC
// ════════════════════════════════════════════════════════════
async function executeSync(analysis) {
  const {
    deptsToAdd, deptsToDelete,
    duplicateDepts, duplicateUnits,
    unitsToAdd, unitsToDelete,
    dbDeptByName, deptIdByName,
    dbUnitsByDept,
  } = analysis;

  section('EXECUTING SYNCHRONIZATION');

  let added = { depts: 0, units: 0 };
  let deleted = { depts: 0, units: 0 };
  let deduped = { depts: 0, units: 0 };
  const errors = [];

  // ── A. Remove duplicate departments (keep first, delete rest) ──
  log('\n[A] Removing duplicate administrations...');
  for (const dup of duplicateDepts) {
    const toKeep = dup.records[0];
    const toRemove = dup.records.slice(1);
    for (const r of toRemove) {
      // Reassign units of the duplicate to the kept record
      const { error: reassignErr } = await supabase
        .from('health_units')
        .update({ department_id: toKeep.id })
        .eq('department_id', r.id);
      if (reassignErr) errors.push(`Reassign units from dup dept ${r.id}: ${reassignErr.message}`);

      const { error: delErr } = await supabase
        .from('departments').delete().eq('id', r.id);
      if (delErr) errors.push(`Delete dup dept ${r.id}: ${delErr.message}`);
      else deduped.depts++;
    }
    log(`  ✅ Kept ${toKeep.id} for "${dup.name}", removed ${toRemove.length} duplicate(s)`);
    // Update deptIdByName to point to kept record
    deptIdByName[dup.name] = toKeep.id;
  }

  // ── B. Remove duplicate health units (keep first, delete rest) ──
  log('\n[B] Removing duplicate health units...');
  for (const dup of duplicateUnits) {
    const toRemove = dup.records.slice(1);
    for (const r of toRemove) {
      const { error: delErr } = await supabase
        .from('health_units').delete().eq('id', r.id);
      if (delErr) errors.push(`Delete dup unit ${r.id}: ${delErr.message}`);
      else deduped.units++;
    }
    log(`  ✅ Kept one record for [${dup.dept}] "${dup.name}", removed ${toRemove.length}`);
  }
  if (duplicateUnits.length === 0) log('  ✅ No duplicates found');

  // ── C. Add missing departments ──
  log('\n[C] Adding new administrations...');
  for (const deptName of deptsToAdd) {
    const { data, error } = await supabase
      .from('departments')
      .insert({ name: deptName })
      .select('id')
      .single();
    if (error) {
      errors.push(`Add dept "${deptName}": ${error.message}`);
      log(`  ❌ Failed to add "${deptName}": ${error.message}`);
    } else {
      deptIdByName[deptName] = data.id;
      added.depts++;
      log(`  ➕ Added "${deptName}" (id: ${data.id})`);
    }
  }
  if (deptsToAdd.length === 0) log('  ✅ None needed');

  // ── D. Add missing health units ──
  log('\n[D] Adding new health units...');
  for (const unit of unitsToAdd) {
    const deptId = deptIdByName[unit.dept];
    if (!deptId) {
      errors.push(`No dept id for "${unit.dept}" when adding unit "${unit.name}"`);
      log(`  ❌ Cannot add unit "${unit.name}" — no dept id for "${unit.dept}"`);
      continue;
    }
    const targets = DEPT_TARGETS[unit.dept] || { daily: 3, monthly: 66 };
    const code = generateCode(unit.dept, unit.name);
    const { error } = await supabase.from('health_units').insert({
      department_id: deptId,
      name: unit.name,
      code,
      daily_target: targets.daily,
      monthly_target: targets.monthly,
      active: true,
    });
    if (error) {
      // If code collision, try with suffix
      const code2 = code + '-' + Math.floor(Math.random() * 900 + 100);
      const { error: e2 } = await supabase.from('health_units').insert({
        department_id: deptId,
        name: unit.name,
        code: code2,
        daily_target: targets.daily,
        monthly_target: targets.monthly,
        active: true,
      });
      if (e2) {
        errors.push(`Add unit [${unit.dept}] "${unit.name}": ${e2.message}`);
        log(`  ❌ Failed to add [${unit.dept}] "${unit.name}": ${e2.message}`);
      } else {
        added.units++;
        log(`  ➕ Added [${unit.dept}] "${unit.name}" (code: ${code2})`);
      }
    } else {
      added.units++;
      log(`  ➕ Added [${unit.dept}] "${unit.name}" (code: ${code})`);
    }
  }
  if (unitsToAdd.length === 0) log('  ✅ None needed');

  // ── E. Delete obsolete health units first (before deleting depts) ──
  log('\n[E] Deleting obsolete health units...');
  const unitIdsToDelete = unitsToDelete.map(u => u.id);
  // Deduplicate ids (same unit may appear for dept-delete + unit-delete)
  const uniqueUnitIds = [...new Set(unitIdsToDelete)];
  for (const uid of uniqueUnitIds) {
    const { error } = await supabase.from('health_units').delete().eq('id', uid);
    if (error) errors.push(`Delete unit ${uid}: ${error.message}`);
    else deleted.units++;
  }
  if (unitsToDelete.length === 0) log('  ✅ None to delete');
  else log(`  🗑️  Deleted ${deleted.units} health unit(s)`);

  // ── F. Delete obsolete departments ──
  log('\n[F] Deleting obsolete administrations...');
  for (const deptName of deptsToDelete) {
    const records = dbDeptByName.get(deptName) || [];
    for (const rec of records) {
      const { error } = await supabase.from('departments').delete().eq('id', rec.id);
      if (error) errors.push(`Delete dept "${deptName}": ${error.message}`);
      else deleted.depts++;
    }
    log(`  🗑️  Deleted "${deptName}"`);
  }
  if (deptsToDelete.length === 0) log('  ✅ None to delete');

  return { added, deleted, deduped, errors };
}

// ════════════════════════════════════════════════════════════
// STEP 5: FINAL VALIDATION
// ════════════════════════════════════════════════════════════
async function validateFinalState() {
  section('FINAL VALIDATION');

  const { depts: finalDepts, units: finalUnits } = await fetchDbState();

  const deptIdToName = new Map(finalDepts.map(d => [d.id, normalize(d.name)]));

  // Build DB map
  const dbDeptNames = new Set(finalDepts.map(d => normalize(d.name)));
  const jsonDeptNames = new Set(Object.keys(JSON_DEPTS));

  const missingDepts  = [...jsonDeptNames].filter(n => !dbDeptNames.has(n));
  const extraDepts    = [...dbDeptNames].filter(n => !jsonDeptNames.has(n));

  // Check units
  const missingUnits = [];
  const extraUnits   = [];

  // Group final db units by dept name
  const finalUnitsByDept = {};
  for (const u of finalUnits) {
    const dn = deptIdToName.get(u.department_id) || '__unknown__';
    if (!finalUnitsByDept[dn]) finalUnitsByDept[dn] = new Set();
    finalUnitsByDept[dn].add(normalize(u.name));
  }

  for (const deptName of jsonDeptNames) {
    const jsonUnits = new Set(JSON_UNITS[deptName]);
    const dbUnits   = finalUnitsByDept[deptName] || new Set();
    for (const u of jsonUnits) if (!dbUnits.has(u)) missingUnits.push(`[${deptName}] ${u}`);
    for (const u of dbUnits)  if (!jsonUnits.has(u)) extraUnits.push(`[${deptName}] ${u}`);
  }

  const passed = missingDepts.length === 0 && extraDepts.length === 0 &&
    missingUnits.length === 0 && extraUnits.length === 0;

  log(`\n🏥 Final DB State: ${finalDepts.length} administrations, ${finalUnits.length} health units`);
  log(`📊 JSON Expected : ${jsonDeptNames.size} administrations, ` +
      `${Object.values(JSON_UNITS).reduce((s, a) => s + a.length, 0)} health units`);

  if (missingDepts.length)  { log('\n❌ Missing admins:'); missingDepts.forEach(d => log('  - ' + d)); }
  if (extraDepts.length)    { log('\n⚠️  Extra admins:');  extraDepts.forEach(d => log('  - ' + d)); }
  if (missingUnits.length)  { log('\n❌ Missing units:');  missingUnits.forEach(u => log('  - ' + u)); }
  if (extraUnits.length)    { log('\n⚠️  Extra units:');   extraUnits.forEach(u => log('  - ' + u)); }

  if (passed) {
    log('\n✅ VALIDATION PASSED — Database is an exact mirror of the JSON file!');
  } else {
    log('\n❌ VALIDATION FAILED — Some discrepancies remain (see above).');
  }

  return passed;
}

// ════════════════════════════════════════════════════════════
// CODE GENERATOR for new units
// ════════════════════════════════════════════════════════════
function generateCode(deptName, unitName) {
  const deptAbbr = deptName.replace(/[\s\u0600-\u06FF]/g, (c) => {
    const map = { 'س': 'S', 'و': 'W', 'ه': 'H', 'ا': 'A', 'ج': 'G', 'ط': 'T', 'م': 'M',
                  'ر': 'R', 'غ': 'GH', 'ة': 'H', 'ب': 'B', 'ل': 'L', 'ن': 'N', 'ي': 'Y',
                  'ك': 'K', 'ق': 'Q', 'خ': 'KH', 'ف': 'F', 'ع': 'E', 'ح': 'HA', 'د': 'D',
                  'ز': 'Z', 'ص': 'SO', ' ': '' };
    return map[c] || '';
  }).slice(0, 4).toUpperCase() || 'UN';

  const unitAbbr = unitName.replace(/\s+/g, '').slice(0, 3).toUpperCase() || 'U';
  return `${deptAbbr}-${unitAbbr}`;
}

// ════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  hr('═');
  log('  🏥 CHRONIC DISEASE INITIATIVE — MASTER DATA SYNC');
  log(`  📅 ${new Date().toLocaleString('ar-EG')}`);
  hr('═');

  // Step 1: Fetch DB
  log('\n⏳ Fetching current database state...');
  const dbState = await fetchDbState();
  log(`   Found ${dbState.depts.length} departments, ${dbState.units.length} health units in DB`);

  // Step 2: Analyse
  log('\n⏳ Analysing differences...');
  const analysis = analyse(dbState);

  // Step 3: Report
  printReport(analysis, dbState);

  // Step 4: Execute
  const result = await executeSync(analysis);

  // Step 5: Validate
  const passed = await validateFinalState();

  // Final summary
  section('SYNC SUMMARY');
  log(`  ➕ Administrations added    : ${result.added.depts}`);
  log(`  ➕ Health units added       : ${result.added.units}`);
  log(`  🗑️  Administrations deleted  : ${result.deleted.depts}`);
  log(`  🗑️  Health units deleted     : ${result.deleted.units}`);
  log(`  🔧 Duplicate admins removed : ${result.deduped.depts}`);
  log(`  🔧 Duplicate units removed  : ${result.deduped.units}`);
  log(`  ❌ Errors                   : ${result.errors.length}`);

  if (result.errors.length > 0) {
    log('\n  Error details:');
    result.errors.forEach(e => log('  ! ' + e));
  }

  hr();
  log(passed
    ? '  🎉 SYNC COMPLETE — Database matches JSON source of truth.'
    : '  ⚠️  SYNC FINISHED WITH ISSUES — See validation report above.');
  hr();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
