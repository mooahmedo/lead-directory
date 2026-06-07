const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function checkOrphans() {
  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: publicUsers } = await supabase.from('users').select('id, email');
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  
  const authIds = new Set(authUsers.users.map(u => u.id));
  const orphans = publicUsers.filter(u => !authIds.has(u.id));
  
  console.log(`Found ${orphans.length} orphaned users in public.users`);
  console.log(orphans);
}

checkOrphans();
