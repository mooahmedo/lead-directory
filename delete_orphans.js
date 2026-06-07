const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function deleteOrphans() {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log("Fetching public users...");
  const { data: publicUsers, error: fetchErr } = await supabase.from('users').select('id, email');
  if (fetchErr) throw fetchErr;

  console.log(`Found ${publicUsers.length} users in public.users`);

  console.log("Fetching auth users...");
  const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
  if (authErr) throw authErr;

  const authIds = new Set(authUsers.users.map(u => u.id));
  const orphans = publicUsers.filter(u => !authIds.has(u.id));

  console.log(`Found ${orphans.length} orphaned users. Deleting them now...`);

  if (orphans.length === 0) {
    console.log("No orphans found. Exiting.");
    return;
  }

  const orphanIds = orphans.map(o => o.id);
  
  // Since we might have foreign keys from audit_logs or visits to these users,
  // we need to be careful. Wait, visits and audit_logs refer to users.id.
  // If we delete the user, it might fail if there's no ON DELETE CASCADE on visits.
  // Let's try to delete them. If it fails, we'll see the error.
  
  const { error: deleteErr } = await supabase
    .from('users')
    .delete()
    .in('id', orphanIds);

  if (deleteErr) {
    console.error("Error deleting orphans:", deleteErr);
  } else {
    console.log("Successfully deleted all orphaned users.");
  }
}

deleteOrphans().catch(console.error);
