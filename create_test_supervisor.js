const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function run() {
  const email = 'supervisor_test@test.com';
  const password = 'Password123!';
  
  // Create user
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: 'مدير النظام للتجربة',
      role: 'supervisor'
    }
  });

  if (error) {
    if (error.message.includes('already exists')) {
      console.log('User already exists');
      return;
    }
    console.error('Error creating user:', error);
    return;
  }
  
  console.log('Test supervisor created successfully!');
}

run();
