import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'd:/Projects/saas_one/.env' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const code = 'PROP-004-ITEM-1771920654490-MISE-MM0BT38A';
  const { data, error } = await supabase.from('stock_items').select('*').or(`barcode.eq.${code},item_code.eq.${code}`);
  console.log('Result length:', data?.length);
  console.log('Error:', error);
  if (data?.length) {
    console.log(data[0].barcode, data[0].item_code, data[0].property_id);
  }
}
run();
