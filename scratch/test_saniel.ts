import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env', 'utf-8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].replace(/['"]+/g, '').trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].replace(/['"]+/g, '').trim();

const supabase = createClient(url, key);

async function run() {
    const { data: users, error } = await supabase.auth.admin.listUsers();
    if (error) {
        console.error("error:", error);
    } else {
        const saniel = users.users.find(u => 
            (u.email && u.email.toLowerCase().includes('saniel')) || 
            (u.user_metadata && u.user_metadata.name && u.user_metadata.name.toLowerCase().includes('saniel'))
        );
        if (saniel) {
            console.log("Saniel found:", saniel.email, saniel.phone, saniel.user_metadata);
        } else {
            console.log("Saniel not found in auth.users");
        }
    }
}

run();
