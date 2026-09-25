import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function testQuery() {
    const otherHrUserId = '990965fe-039a-4144-8880-9e7a9f5f175b';
    const conditionOther = `and(is_confidential.neq.true,is_anonymous.neq.true),assigned_to_user_id.eq.${otherHrUserId},assigned_history.cs.["${otherHrUserId}"]`;
    const { data: otherTickets } = await supabaseAdmin
        .from('hr_tickets')
        .select('id, ticket_number, ticket_type, is_confidential, is_anonymous, assigned_to_user_id')
        .or(conditionOther);

    console.log('Other tickets:', otherTickets);
}

testQuery();
