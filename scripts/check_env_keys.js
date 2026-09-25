const fs = require('fs');
const dotenv = require('dotenv');

if (fs.existsSync('.env.local')) {
    console.log('Keys in .env.local:', Object.keys(dotenv.parse(fs.readFileSync('.env.local'))));
}
if (fs.existsSync('.env')) {
    console.log('Keys in .env:', Object.keys(dotenv.parse(fs.readFileSync('.env'))));
}
