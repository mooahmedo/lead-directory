const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Parse .env manually
const envFile = fs.readFileSync('.env', 'utf8');
const envParams = envFile.split('\n').reduce((acc, line) => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    acc[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
  return acc;
}, {});

const supabase = createClient(
  envParams.NEXT_PUBLIC_SUPABASE_URL,
  envParams.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Approved facility master data (212 facilities total)
// Key = Arabic name fragment to match department, Value = { facilities, dailyTarget }
const DEPT_TARGETS = [
  { nameFragment: 'سوهاج',       facilities: 27, dailyTarget: 3 },
  { nameFragment: 'المنشا',      facilities: 22, dailyTarget: 3 },  // matches المنشاة or المنشأة
  { nameFragment: 'البلينا',     facilities: 20, dailyTarget: 3 },
  { nameFragment: 'جرجا',        facilities: 23, dailyTarget: 2 },
  { nameFragment: 'أخميم',       facilities: 12, dailyTarget: 4 },
  { nameFragment: 'طما',         facilities: 22, dailyTarget: 2 },
  { nameFragment: 'طهطا',        facilities: 21, dailyTarget: 3 },
  { nameFragment: 'المراغة',     facilities: 19, dailyTarget: 2 },
  { nameFragment: 'دار السلام',  facilities: 17, dailyTarget: 3 },
  { nameFragment: 'جهينة',       facilities: 11, dailyTarget: 3 },
  { nameFragment: 'ساقلتة',      facilities: 18, dailyTarget: 2 },
  // El Asirat is in DB but not in the provided list — keep existing targets
];

// Working days per month for monthly target calculation
const WORKING_DAYS_PER_MONTH = 22;

async function main() {
  console.log('🏥 Updating Chronic Disease Initiative Facility Targets...\n');

  // Fetch all departments
  const { data: departments, error: deptErr } = await supabase
    .from('departments')
    .select('id, name');

  if (deptErr) {
    console.error('❌ Failed to fetch departments:', deptErr.message);
    process.exit(1);
  }

  console.log(`📋 Found ${departments.length} departments in database:`);
  departments.forEach(d => console.log(`   - ${d.name}`));
  console.log('');

  let totalUpdated = 0;
  const results = [];

  for (const config of DEPT_TARGETS) {
    // Find matching department
    const dept = departments.find(d => d.name.includes(config.nameFragment));
    if (!dept) {
      console.warn(`⚠️  No department found matching: "${config.nameFragment}"`);
      results.push({ dept: config.nameFragment, status: 'NOT FOUND', updated: 0 });
      continue;
    }

    const monthlyTarget = config.dailyTarget * WORKING_DAYS_PER_MONTH;

    console.log(`🔄 Updating "${dept.name}" (${config.facilities} facilities, daily: ${config.dailyTarget}, monthly: ${monthlyTarget})...`);

    // Update all active health units in this department
    const { data: updated, error: updateErr } = await supabase
      .from('health_units')
      .update({
        daily_target: config.dailyTarget,
        monthly_target: monthlyTarget,
      })
      .eq('department_id', dept.id)
      .eq('active', true)
      .select('id, name, code');

    if (updateErr) {
      console.error(`   ❌ Error: ${updateErr.message}`);
      results.push({ dept: dept.name, status: 'ERROR', updated: 0, error: updateErr.message });
      continue;
    }

    console.log(`   ✅ Updated ${updated.length} units`);
    totalUpdated += updated.length;
    results.push({
      dept: dept.name,
      status: 'OK',
      updated: updated.length,
      expected: config.facilities,
      dailyTarget: config.dailyTarget,
      monthlyTarget,
    });
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('📊 UPDATE SUMMARY');
  console.log('═══════════════════════════════════════════');
  results.forEach(r => {
    if (r.status === 'OK') {
      const match = r.updated === r.expected ? '✅' : `⚠️  (expected ${r.expected})`;
      console.log(`${match} ${r.dept}: ${r.updated} units | daily=${r.dailyTarget}, monthly=${r.monthlyTarget}`);
    } else if (r.status === 'NOT FOUND') {
      console.log(`❌ NOT FOUND: ${r.dept}`);
    } else {
      console.log(`❌ ERROR in ${r.dept}: ${r.error}`);
    }
  });

  console.log(`\n🎉 Total units updated: ${totalUpdated}`);
  console.log('📁 Expected total facilities: 212');
}

main().catch(console.error);
