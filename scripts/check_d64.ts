import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  const { data: p } = await supabaseAdmin.from('employee_profiles').select('*, user:users!employee_profiles_user_id_fkey(*)').eq('id', 'd64e8e5b-6031-4c3e-9041-8e1bd69e858f').maybeSingle();
  console.log('Profile d64e8e5b:', p);
}
check();
