const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

async function checkConstraints() {
  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data, error } = await supabase.rpc('run_sql', { query: "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.users'::regclass" });
  if (error) {
    console.error("RPC failed, trying raw query via REST...");
  } else {
    console.log("Constraints:", data);
  }
}

checkConstraints();
