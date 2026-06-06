const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envFile = fs.readFileSync('.env', 'utf8');
const envParams = envFile.split('\n').reduce((acc, line) => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    acc[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
  return acc;
}, {});

const supabase = createClient(envParams.NEXT_PUBLIC_SUPABASE_URL, envParams.SUPABASE_SERVICE_ROLE_KEY);

function normalizeDeptName(name) {
  return name
    .replace('إدارة', '')
    .replace('الصحية', '')
    .replace(/أ/g, 'ا')
    .replace(/إ/g, 'ا')
    .replace(/ة/g, 'ه')
    .trim();
}

function generateCode(deptPrefix, index) {
  // Pad index to 3 digits
  const idx = String(index).padStart(3, '0');
  return `${deptPrefix}-${idx}`;
}

const DEPT_PREFIXES = {
  "طهطا": "TAH",
  "طما": "TMA",
  "سوهاج": "SHG",
  "ساقلتة": "SAQ",
  "دار السلام": "DAR",
  "جهينة": "JUH",
  "جرجا": "GER",
  "المنشاة": "MNS",
  "المراغة": "MAR",
  "البلينا": "BAL",
  "اخميم": "AKH",
  "أخميم": "AKH"
};

async function main() {
  try {
    const jsonData = JSON.parse(fs.readFileSync('c:\\Users\\pc\\Downloads\\chronic_disease_units.json', 'utf8'));
    
    // 1. Insert missing department `جرجا` if it doesn't exist
    console.log("Checking departments...");
    const { data: dbDepartments, error: deptErr } = await supabase.from('departments').select('*');
    if (deptErr) throw deptErr;

    const dbDeptMap = new Map();
    dbDepartments.forEach(d => dbDeptMap.set(normalizeDeptName(d.name), d));

    if (!dbDeptMap.has(normalizeDeptName('جرجا'))) {
      console.log("Inserting missing department: إدارة جرجا الصحية");
      const { data: newDept, error: insertDeptErr } = await supabase
        .from('departments')
        .insert({ name: 'إدارة جرجا الصحية' })
        .select()
        .single();
      if (insertDeptErr) throw insertDeptErr;
      dbDeptMap.set(normalizeDeptName(newDept.name), newDept);
      console.log("Successfully inserted.");
    }

    // 2. Fetch units to find which ones to deactivate and what already exists
    const { data: dbUnits, error: unitErr } = await supabase.from('health_units').select('*');
    if (unitErr) throw unitErr;

    const dbUnitNameMap = new Map();
    dbUnits.forEach(u => dbUnitNameMap.set(u.name.trim(), u));

    // 3. Deactivate old mock test units
    console.log("Deactivating old mock test units...");
    const jsonUnitNames = new Set();
    Object.values(jsonData).forEach(units => units.forEach(u => jsonUnitNames.add(u.trim())));

    const unitsToDeactivate = dbUnits.filter(u => u.active && !jsonUnitNames.has(u.name.trim()));
    if (unitsToDeactivate.length > 0) {
      const ids = unitsToDeactivate.map(u => u.id);
      const { error: deactErr } = await supabase
        .from('health_units')
        .update({ active: false })
        .in('id', ids);
      if (deactErr) throw deactErr;
      console.log(`Deactivated ${ids.length} old mock units.`);
    } else {
      console.log("No active old mock units to deactivate.");
    }

    // 4. Insert missing units
    console.log("Inserting new health units...");
    let unitsToInsert = [];
    
    for (const [deptName, units] of Object.entries(jsonData)) {
      const normJsonDept = normalizeDeptName(deptName);
      const dbDept = dbDeptMap.get(normJsonDept);
      if (!dbDept) {
        throw new Error(`Department ${deptName} not found in DB even after checking/inserting.`);
      }

      const prefix = DEPT_PREFIXES[normJsonDept] || "UNT";
      let count = 1;

      for (const unitName of units) {
        const uName = unitName.trim();
        
        // Ensure code uniqueness - some might already be in DB if we run this twice
        if (!dbUnitNameMap.has(uName)) {
          unitsToInsert.push({
            code: generateCode(prefix, count),
            name: uName,
            department_id: dbDept.id,
            active: true,
            daily_target: 15,
            monthly_target: 300
          });
        }
        count++;
      }
    }

    if (unitsToInsert.length > 0) {
      console.log(`Found ${unitsToInsert.length} units to insert.`);
      // Supabase has a max limit for inserts, usually 1000 is fine, but we can do batches of 50 just in case.
      const BATCH_SIZE = 50;
      for (let i = 0; i < unitsToInsert.length; i += BATCH_SIZE) {
        const batch = unitsToInsert.slice(i, i + BATCH_SIZE);
        const { error: insErr } = await supabase.from('health_units').insert(batch);
        if (insErr) {
          // If a code conflict happens, it might fail. We'll add random digits if it does.
          if (insErr.code === '23505') { // unique violation
             console.log("Code conflict, appending random suffixes...");
             const fixedBatch = batch.map(u => ({ ...u, code: u.code + '-' + Math.floor(Math.random() * 1000) }));
             const { error: retryErr } = await supabase.from('health_units').insert(fixedBatch);
             if (retryErr) throw retryErr;
          } else {
            throw insErr;
          }
        }
        console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}`);
      }
      console.log(`Successfully inserted ${unitsToInsert.length} new units.`);
    } else {
      console.log("No new units to insert.");
    }

    console.log("Synchronization complete.");

  } catch (err) {
    console.error("Error during synchronization:", err);
  }
}

main();
