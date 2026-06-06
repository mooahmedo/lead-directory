require("dotenv").config({ path: ".env" });
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Generate random password
function generatePassword() {
  return "Temp@" + Math.random().toString(36).slice(-6);
}

// Map English names to Arabic for usernames if needed, but we'll use English prefixes
// nurse_shg001, coord_shg01, etc.
let nurseCounter = 1;
let coordCounter = 1;

async function seed() {
  console.log("Fetching departments and units...");
  const { data: depts, error: deptsError } = await supabase.from("departments").select("*").order("name");
  const { data: units, error: unitsError } = await supabase.from("health_units").select("*").order("name");

  if (deptsError) throw deptsError;
  if (unitsError) throw unitsError;

  console.log(`Found ${depts.length} departments and ${units.length} units.`);

  const accountsCreated = [];

  // 1. General Initiative Coordinator
  console.log("Creating General Initiative Coordinator...");
  const genPass = generatePassword();
  const genUsername = "supervisor_shg";
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: "supervisor@sohag.gov.eg",
    password: genPass,
    email_confirm: true,
    user_metadata: {
      full_name: "المنسق العام للمبادرة",
      username: genUsername,
      role: "supervisor",
      must_change_password: true,
    },
  });
  if (authError && authError.message.includes("already exists")) {
    console.log("General Coordinator already exists (email). Skipping.");
  } else if (authError) {
    console.error("Failed to create General Coordinator:", authError.message);
  } else {
    accountsCreated.push({ Name: "المنسق العام للمبادرة", Username: genUsername, Password: genPass, Role: "supervisor" });
  }

  // 2. Administration Coordinators
  console.log("Creating Administration Coordinators...");
  for (const dept of depts) {
    const pass = generatePassword();
    const username = `coord_${coordCounter.toString().padStart(2, "0")}`;
    coordCounter++;
    
    const email = `coord_${dept.id.slice(0, 8)}@sohag.gov.eg`;
    
    const { data: cUser, error: cError } = await supabase.auth.admin.createUser({
      email,
      password: pass,
      email_confirm: true,
      user_metadata: {
        full_name: `منسق إدارة ${dept.name}`,
        username: username,
        role: "coordinator",
        department_id: dept.id,
        must_change_password: true,
      },
    });
    
    if (cError && cError.message.includes("already exists")) {
      console.log(`Coordinator for ${dept.name} already exists. Skipping.`);
    } else if (cError) {
      console.error(`Failed to create Coordinator for ${dept.name}:`, cError.message);
    } else {
      accountsCreated.push({ Name: `منسق إدارة ${dept.name}`, Username: username, Password: pass, Role: "coordinator", Dept: dept.name });
    }
  }

  // 3. Nurses (1 per unit)
  console.log("Creating Nurses...");
  for (const unit of units) {
    const dept = depts.find(d => d.id === unit.department_id);
    const deptName = dept ? dept.name : "غير محدد";
    
    const pass = generatePassword();
    const username = `nurse_${nurseCounter.toString().padStart(3, "0")}`;
    nurseCounter++;
    
    const email = `nurse_${unit.id.slice(0, 8)}@sohag.gov.eg`;

    const { data: nUser, error: nError } = await supabase.auth.admin.createUser({
      email,
      password: pass,
      email_confirm: true,
      user_metadata: {
        full_name: `تمريض وحدة ${unit.name}`,
        username: username,
        role: "nurse",
        department_id: unit.department_id,
        unit_id: unit.id,
        must_change_password: true,
      },
    });

    if (nError && nError.message.includes("already exists")) {
      // already exists
    } else if (nError) {
      console.error(`Failed to create Nurse for ${unit.name}:`, nError.message);
    } else {
      accountsCreated.push({ Name: `تمريض وحدة ${unit.name}`, Username: username, Password: pass, Role: "nurse", Unit: unit.name, Dept: deptName });
    }
  }

  console.log("\n==============================================");
  console.log(`Successfully created ${accountsCreated.length} accounts.`);
  console.log("Here is a sample of the created accounts (username / password):");
  accountsCreated.slice(0, 15).forEach(a => {
    console.log(`${a.Role.padEnd(12)} | ${a.Name.padEnd(30)} | User: ${a.Username.padEnd(15)} | Pass: ${a.Password}`);
  });
  console.log("==============================================\n");
  
  // Write all credentials to a file for the admin to distribute
  const fs = require("fs");
  const creds = accountsCreated.map(a => `${a.Role},"${a.Name}","${a.Username}","${a.Password}","${a.Dept || ""}","${a.Unit || ""}"`).join("\n");
  fs.writeFileSync("credentials.csv", "\uFEFFRole,Name,Username,Password,Department,Unit\n" + creds, "utf8");
  console.log("Saved all credentials to credentials.csv");
}

seed().catch(console.error);
