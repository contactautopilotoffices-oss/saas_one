const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

console.log('Available keys in process.env:');
Object.keys(process.env).forEach(k => {
    if (k.includes('SUPABASE') || k.includes('DB') || k.includes('POSTGRES') || k.includes('DATABASE')) {
        console.log(k);
    }
});
