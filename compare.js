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

async function main() {
  try {
    const jsonData = JSON.parse(fs.readFileSync('c:\\Users\\pc\\Downloads\\chronic_disease_units.json', 'utf8'));
    
    const { data: dbDepartments, error: deptErr } = await supabase.from('departments').select('*');
    if (deptErr) throw deptErr;

    const { data: dbUnits, error: unitErr } = await supabase.from('health_units').select('*');
    if (unitErr) throw unitErr;

    const report = [];
    report.push('# Master Data Comparison Report\n');

    const dbDeptMap = new Map(); // normalized name -> db record
    dbDepartments.forEach(d => {
      dbDeptMap.set(normalizeDeptName(d.name), d);
    });
    
    const dbDeptIdToName = new Map(dbDepartments.map(d => [d.id, d.name.trim()]));
    
    const dbUnitNameMap = new Map();
    dbUnits.forEach(u => {
      const n = u.name.trim();
      if (!dbUnitNameMap.has(n)) dbUnitNameMap.set(n, []);
      dbUnitNameMap.get(n).push(u);
    });

    const missingAdministrations = [];
    const missingHealthUnits = [];
    const duplicateRecordsInDB = [];
    const incorrectAssignments = [];
    const inactiveRecordsThatShouldBeActive = [];

    let totalJsonUnits = 0;
    
    for (const [deptName, units] of Object.entries(jsonData)) {
      totalJsonUnits += units.length;
      const normJsonDept = normalizeDeptName(deptName);
      let dbDept = dbDeptMap.get(normJsonDept);
      
      if (!dbDept) {
        missingAdministrations.push(deptName);
      }

      for (const unitName of units) {
        const uName = unitName.trim();
        const unitsInDb = dbUnitNameMap.get(uName) || [];
        const dbUnitsWithSameDept = unitsInDb.filter(u => normalizeDeptName(dbDeptIdToName.get(u.department_id)) === normJsonDept);

        if (dbUnitsWithSameDept.length === 0) {
          missingHealthUnits.push(`[${deptName}] - ${uName}`);
        } else if (dbUnitsWithSameDept.length > 1) {
          duplicateRecordsInDB.push(`[${deptName}] - ${uName} (${dbUnitsWithSameDept.length} instances in this department)`);
          let hasCorrectActive = false;
          for (const dbU of dbUnitsWithSameDept) {
            if (dbU.active) hasCorrectActive = true;
          }
          if (!hasCorrectActive) {
            inactiveRecordsThatShouldBeActive.push(`[${deptName}] - ${uName}`);
          }
        } else {
          const dbU = dbUnitsWithSameDept[0];
          if (!dbU.active) {
            inactiveRecordsThatShouldBeActive.push(`[${deptName}] - ${uName}`);
          }
        }
      }
    }

    report.push(`## Summary`);
    report.push(`- **JSON Data**: ${Object.keys(jsonData).length} Administrations, ${totalJsonUnits} Health Units`);
    report.push(`- **DB Data**: ${dbDepartments.length} Administrations, ${dbUnits.length} Health Units (${dbUnits.filter(u=>u.active).length} Active)\n`);

    report.push(`## 1. Missing Administrations (${missingAdministrations.length})`);
    if (missingAdministrations.length > 0) missingAdministrations.forEach(x => report.push(`- ${x}`));
    else report.push('- None');
    report.push('');

    report.push(`## 2. Missing Health Units (${missingHealthUnits.length})`);
    if (missingHealthUnits.length > 0) missingHealthUnits.forEach(x => report.push(`- ${x}`));
    else report.push('- None');
    report.push('');

    report.push(`## 3. Duplicate Records in DB (${duplicateRecordsInDB.length})`);
    if (duplicateRecordsInDB.length > 0) duplicateRecordsInDB.forEach(x => report.push(`- ${x}`));
    else report.push('- None');
    report.push('');

    report.push(`## 4. Incorrect Administration Assignments (${incorrectAssignments.length})`);
    if (incorrectAssignments.length > 0) incorrectAssignments.forEach(x => report.push(`- ${x}`));
    else report.push('- None');
    report.push('');

    report.push(`## 5. Inactive Records that should be Active (${inactiveRecordsThatShouldBeActive.length})`);
    if (inactiveRecordsThatShouldBeActive.length > 0) inactiveRecordsThatShouldBeActive.forEach(x => report.push(`- ${x}`));
    else report.push('- None');
    report.push('');

    fs.writeFileSync('C:\\Users\\pc\\.gemini\\antigravity-ide\\brain\\0ea65faf-4b92-4899-abf6-db07cf041650\\comparison_report.md', report.join('\n'));
    console.log('Report generated successfully.');
  } catch (err) {
    console.error(err);
  }
}

main();
