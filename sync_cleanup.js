/**
 * Phase 2: Batch cleanup + final validation
 * Deletes all health_units NOT in the JSON, and all departments NOT in the JSON
 * Uses batch operations (in() filter) instead of one-by-one deletes
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

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

const JSON_PATH = 'C:\\Users\\pc\\Downloads\\chronic_disease_units (2).json';
const rawJson = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const normalize = (s) => s.replace(/\s+/g, ' ').trim();

// Build JSON reference sets
const JSON_DEPT_NAMES = new Set(Object.keys(rawJson).map(normalize));
const JSON_UNIT_BY_DEPT = {};
for (const [dept, units] of Object.entries(rawJson)) {
  JSON_UNIT_BY_DEPT[normalize(dept)] = new Set(units.map(normalize));
}

function log(msg) { process.stdout.write(msg + '\n'); }
function hr(c = '═', n = 60) { log(c.repeat(n)); }

async function main() {
  hr();
  log('  🧹 PHASE 2: BATCH CLEANUP + VALIDATION');
  log(`  📅 ${new Date().toLocaleString('ar-EG')}`);
  hr();

  // ── 1. Fetch current DB state ──────────────────────────
  log('\n⏳ Fetching current DB state...');
  const { data: dbDepts, error: dErr } = await supabase.from('departments').select('*');
  if (dErr) { log('❌ ' + dErr.message); process.exit(1); }
  const { data: dbUnits, error: uErr } = await supabase.from('health_units').select('*');
  if (uErr) { log('❌ ' + uErr.message); process.exit(1); }

  log(`   Current DB: ${dbDepts.length} departments, ${dbUnits.length} health units`);

  const deptIdToName = new Map(dbDepts.map(d => [d.id, normalize(d.name)]));

  // ── 2. Find obsolete departments ────────────────────────
  const obsoleteDepts = dbDepts.filter(d => !JSON_DEPT_NAMES.has(normalize(d.name)));
  log(`\n🗑️  Obsolete departments to delete: ${obsoleteDepts.length}`);
  obsoleteDepts.forEach(d => log(`   - ${d.name}`));

  // ── 3. Find obsolete health units ───────────────────────
  const obsoleteUnitIds = [];
  const obsoleteUnitNames = [];
  
  for (const unit of dbUnits) {
    const deptName = deptIdToName.get(unit.department_id);
    const unitName = normalize(unit.name);

    if (!deptName || !JSON_DEPT_NAMES.has(deptName)) {
      // Belongs to an obsolete dept
      obsoleteUnitIds.push(unit.id);
      obsoleteUnitNames.push(`[${deptName || 'UNKNOWN'}] ${unitName}`);
    } else {
      const jsonUnitsForDept = JSON_UNIT_BY_DEPT[deptName];
      if (!jsonUnitsForDept || !jsonUnitsForDept.has(unitName)) {
        obsoleteUnitIds.push(unit.id);
        obsoleteUnitNames.push(`[${deptName}] ${unitName}`);
      }
    }
  }

  log(`\n🗑️  Obsolete health units to delete: ${obsoleteUnitIds.length}`);
  obsoleteUnitNames.forEach(n => log(`   - ${n}`));

  // ── 4. Batch delete obsolete health units ────────────────
  if (obsoleteUnitIds.length > 0) {
    log('\n⏳ Batch deleting obsolete health units...');
    
    // First, nullify references in the users table to prevent FK constraint errors
    log('   Nullifying unit_id for users referencing obsolete units...');
    const CHUNK = 100;
    for (let i = 0; i < obsoleteUnitIds.length; i += CHUNK) {
      const chunk = obsoleteUnitIds.slice(i, i + CHUNK);
      const { error: fkErr } = await supabase.from('users').update({ unit_id: null }).in('unit_id', chunk);
      if (fkErr) log(`   ⚠️  Failed to nullify users unit_id chunk: ${fkErr.message}`);
    }

    // Now delete the health units
    let totalDeleted = 0;
    for (let i = 0; i < obsoleteUnitIds.length; i += CHUNK) {
      const chunk = obsoleteUnitIds.slice(i, i + CHUNK);
      const { error } = await supabase.from('health_units').delete().in('id', chunk);
      if (error) {
        log(`   ⚠️  Chunk ${i}-${i + CHUNK} error: ${error.message}`);
        // Try individual deletes as fallback
        for (const id of chunk) {
          const { error: e2 } = await supabase.from('health_units').delete().eq('id', id);
          if (e2) log(`      ❌ Failed to delete unit ${id}: ${e2.message}`);
          else totalDeleted++;
        }
      } else {
        totalDeleted += chunk.length;
        log(`   ✅ Deleted ${totalDeleted}/${obsoleteUnitIds.length} units`);
      }
    }
    log(`   🎉 Finished deleting health units: ${totalDeleted} removed`);
  } else {
    log('\n✅ No obsolete health units to delete');
  }

  // ── 5. Delete obsolete departments ───────────────────────
  if (obsoleteDepts.length > 0) {
    log('\n⏳ Deleting obsolete departments...');
    const obsoleteDeptIds = obsoleteDepts.map(d => d.id);
    
    // Nullify department_id in users table
    log('   Nullifying department_id for users referencing obsolete departments...');
    const { error: fkErr } = await supabase.from('users').update({ department_id: null }).in('department_id', obsoleteDeptIds);
    if (fkErr) log(`   ⚠️  Failed to nullify users department_id: ${fkErr.message}`);

    const { error } = await supabase.from('departments').delete().in('id', obsoleteDeptIds);
    if (error) {
      log(`   ⚠️  Batch delete failed: ${error.message}`);
      for (const d of obsoleteDepts) {
        const { error: e2 } = await supabase.from('departments').delete().eq('id', d.id);
        if (e2) log(`   ❌ Failed to delete dept "${d.name}": ${e2.message}`);
        else log(`   🗑️  Deleted "${d.name}"`);
      }
    } else {
      log(`   🎉 Deleted ${obsoleteDepts.length} obsolete department(s)`);
    }
  } else {
    log('\n✅ No obsolete departments to delete');
  }

  // ── 6. Fix المغاربة (failed earlier due to code collision) ──
  log('\n⏳ Checking for any units that failed to insert...');
  const { data: finalDepts } = await supabase.from('departments').select('*');
  const { data: finalUnits } = await supabase.from('health_units').select('*');

  const finalDeptIdToName = new Map(finalDepts.map(d => [d.id, normalize(d.name)]));
  const finalUnitsByDept = {};
  for (const u of finalUnits) {
    const dn = finalDeptIdToName.get(u.department_id);
    if (!finalUnitsByDept[dn]) finalUnitsByDept[dn] = new Set();
    finalUnitsByDept[dn].add(normalize(u.name));
  }

  const missingUnits = [];
  for (const [deptName, jsonUnits] of Object.entries(JSON_UNIT_BY_DEPT)) {
    const dbUnitsForDept = finalUnitsByDept[deptName] || new Set();
    for (const uName of jsonUnits) {
      if (!dbUnitsForDept.has(uName)) {
        missingUnits.push({ dept: deptName, name: uName });
      }
    }
  }

  if (missingUnits.length > 0) {
    log(`   Found ${missingUnits.length} missing unit(s) — inserting now...`);

    const finalDeptNameToId = new Map(finalDepts.map(d => [normalize(d.name), d.id]));
    
    const DEPT_TARGETS = {
      'سوهاج': { daily: 3, monthly: 66 }, 'المنشاة': { daily: 3, monthly: 66 },
      'البلينا': { daily: 3, monthly: 66 }, 'جرجا': { daily: 2, monthly: 44 },
      'اخميم': { daily: 4, monthly: 88 }, 'طما': { daily: 2, monthly: 44 },
      'طهطا': { daily: 3, monthly: 66 }, 'المراغة': { daily: 2, monthly: 44 },
      'دار السلام': { daily: 3, monthly: 66 }, 'جهينة': { daily: 3, monthly: 66 },
      'ساقلتة': { daily: 2, monthly: 44 },
    };

    for (const unit of missingUnits) {
      const deptId = finalDeptNameToId.get(unit.dept);
      if (!deptId) { log(`   ❌ No dept id for "${unit.dept}"`); continue; }
      
      const targets = DEPT_TARGETS[unit.dept] || { daily: 3, monthly: 66 };
      // Use timestamp-based code to guarantee uniqueness
      const code = `${unit.dept.slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;
      
      const { error } = await supabase.from('health_units').insert({
        department_id: deptId,
        name: unit.name,
        code,
        daily_target: targets.daily,
        monthly_target: targets.monthly,
        active: true,
      });
      
      if (error) {
        log(`   ❌ [${unit.dept}] "${unit.name}": ${error.message}`);
      } else {
        log(`   ➕ Added [${unit.dept}] "${unit.name}" (code: ${code})`);
      }
      
      // Small delay to ensure unique timestamps
      await new Promise(r => setTimeout(r, 10));
    }
  } else {
    log('   ✅ All JSON units are present in the database');
  }

  // ── 7. FINAL VALIDATION ──────────────────────────────────
  hr();
  log('  📊 FINAL VALIDATION');
  hr();

  const { data: vDepts } = await supabase.from('departments').select('*');
  const { data: vUnits } = await supabase.from('health_units').select('*');

  const vDeptIdToName = new Map(vDepts.map(d => [d.id, normalize(d.name)]));
  const vDeptNames = new Set(vDepts.map(d => normalize(d.name)));

  const vUnitsByDept = {};
  for (const u of vUnits) {
    const dn = vDeptIdToName.get(u.department_id);
    if (!vUnitsByDept[dn]) vUnitsByDept[dn] = new Set();
    vUnitsByDept[dn].add(normalize(u.name));
  }

  const issues = [];

  // Check depts
  for (const d of JSON_DEPT_NAMES) {
    if (!vDeptNames.has(d)) issues.push(`❌ MISSING DEPT: ${d}`);
  }
  for (const d of vDeptNames) {
    if (!JSON_DEPT_NAMES.has(d)) issues.push(`⚠️  EXTRA DEPT: ${d}`);
  }

  // Check units
  let totalJsonUnits = 0;
  let totalDbUnits = 0;
  for (const [deptName, jsonUnits] of Object.entries(JSON_UNIT_BY_DEPT)) {
    totalJsonUnits += jsonUnits.size;
    const dbUnitsForDept = vUnitsByDept[deptName] || new Set();
    totalDbUnits += dbUnitsForDept.size;

    for (const u of jsonUnits) {
      if (!dbUnitsForDept.has(u)) issues.push(`❌ MISSING UNIT: [${deptName}] ${u}`);
    }
    for (const u of dbUnitsForDept) {
      if (!jsonUnits.has(u)) issues.push(`⚠️  EXTRA UNIT: [${deptName}] ${u}`);
    }
  }

  log(`\n  JSON Source  : ${JSON_DEPT_NAMES.size} administrations, ${totalJsonUnits} health units`);
  log(`  DB Final     : ${vDepts.length} administrations, ${vUnits.length} health units`);

  log('\n  Per-Administration breakdown:');
  for (const [deptName, jsonUnits] of Object.entries(JSON_UNIT_BY_DEPT)) {
    const dbCount = (vUnitsByDept[deptName] || new Set()).size;
    const ok = dbCount === jsonUnits.size ? '✅' : `❌ (DB:${dbCount})`;
    log(`  ${ok} ${deptName}: ${jsonUnits.size} units`);
  }

  if (issues.length === 0) {
    log('\n  🎉 VALIDATION PASSED — Database is an EXACT mirror of the JSON file!');
  } else {
    log(`\n  ❌ VALIDATION: ${issues.length} issue(s) found:`);
    issues.forEach(i => log('    ' + i));
  }

  hr();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
