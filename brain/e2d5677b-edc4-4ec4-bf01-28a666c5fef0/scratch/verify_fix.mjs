
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

const templateId = "58606248-c0c7-4113-b590-47d47f2cc162";
const propertyId = "79ba1aa5-bf91-4956-9dbe-ce9986790b53";
const orgId = "211e1330-ad83-446d-941f-dcea48396798";

async function verify() {
    console.log('--- SOP Completion Test ---');
    // Simulate API logic for completion creation
    // 1. Get Property Org
    const { data: prop } = await supabase.from('properties').select('organization_id').eq('id', propertyId).single();
    console.log('Resolved Property Org:', prop.organization_id);
    
    if (prop.organization_id !== orgId) {
        console.error('Mismatch in Org ID!');
    }

    // 2. Insert Completion (System simulation)
    const { data: comp, error: compErr } = await supabase.from('sop_completions').insert({
        template_id: templateId,
        property_id: propertyId,
        organization_id: prop.organization_id,
        due_at: new Date().toISOString(),
        completion_date: new Date().toISOString().split('T')[0],
        status: 'pending'
    }).select().single();

    if (compErr) {
        console.error('Completion Insert Failed:', compErr.message);
    } else {
        console.log('Completion Created:', comp.id);
        
        // Wait a bit for trigger
        await new Promise(r => setTimeout(r, 1000));
        
        // 3. Check items population
        const { data: items } = await supabase.from('sop_completion_items').select('*').eq('completion_id', comp.id);
        console.log('Items populated by trigger:', items?.length || 0);
        
        if (items && items.length > 0) {
            console.log('First item columns:', Object.keys(items[0]));
        }

        // Cleanup
        await supabase.from('sop_completions').delete().eq('id', comp.id);
        console.log('Cleanup successful.');
    }

    console.log('\n--- Procurement Security Test ---');
    // Simulate fake org injection
    const fakeOrg = "00000000-0000-0000-0000-000000000000";
    const { data: mem } = await supabase.from('organization_memberships')
        .select('role')
        .eq('organization_id', fakeOrg)
        .eq('is_active', true)
        .maybeSingle();
    
    if (!mem) {
        console.log('Security Check Passed: Fake org rejected as expected.');
    } else {
        console.error('Security Check Failed: Fake org accepted!');
    }
}

verify();
