const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

async function testCoordinator() {
  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log("Creating coordinator user...");
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: 'coord_test_' + Date.now() + '@example.com',
    password: 'password123',
    email_confirm: true,
    user_metadata: {
      full_name: 'Test Coord',
      role: 'coordinator',
      department_id: null,
      unit_id: null,
      must_change_password: true,
    },
  });

  if (authError) {
    console.error("Auth Error creating coordinator:", authError);
  } else {
    console.log("Coordinator created successfully:", authUser.user.id);
  }
}

testCoordinator();
