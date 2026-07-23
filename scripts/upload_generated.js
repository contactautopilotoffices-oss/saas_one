
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function uploadImage(inputPath, itemName, catalogId) {
    try {
        let fileContent;
        let fileExt;

        if (inputPath.startsWith('http')) {
            const response = await fetch(inputPath, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.google.com/'
                }
            });
            if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
            const buffer = await response.arrayBuffer();
            fileContent = Buffer.from(buffer);
            fileExt = path.extname(new URL(inputPath).pathname) || '.jpg';
        } else {
            fileContent = fs.readFileSync(inputPath);
            fileExt = path.extname(inputPath);
        }

        const fileName = `${catalogId}_${Date.now()}${fileExt}`;
        const filePath = `catalog/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('procurement-items')
            .upload(filePath, fileContent, {
                contentType: fileExt.endsWith('png') ? 'image/png' : 'image/jpeg',
                upsert: true
            });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('procurement-items')
            .getPublicUrl(filePath);

        const { error: dbError } = await supabase
            .from('procurement_catalog')
            .update({ photo_url: publicUrl })
            .eq('id', catalogId);

        if (dbError) throw dbError;

        console.log(`Success: ${itemName} updated with ${publicUrl}`);
    } catch (err) {
        console.error(`Failed for ${itemName}:`, err);
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.log("Usage: node upload_generated.js <localPath> <itemName> <catalogId>");
        return;
    }
    await uploadImage(args[0], args[1], args[2]);
}

main();
