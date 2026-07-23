
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
        console.log(`Processing: ${itemName} (${catalogId}) ...`);
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
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('image/png')) {
                fileExt = '.png';
            } else if (contentType && contentType.includes('image/jpeg')) {
                fileExt = '.jpg';
            } else if (contentType && contentType.includes('image/webp')) {
                fileExt = '.webp';
            } else {
                fileExt = path.extname(new URL(inputPath).pathname) || '.jpg';
                if (!fileExt.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                    fileExt = '.jpg';
                }
            }
        } else {
            fileContent = fs.readFileSync(inputPath);
            fileExt = path.extname(inputPath);
        }

        const fileName = `${catalogId}_${Date.now()}${fileExt}`;
        const filePath = `catalog/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('procurement-items')
            .upload(filePath, fileContent, {
                contentType: fileExt.endsWith('png') ? 'image/png' : (fileExt.endsWith('webp') ? 'image/webp' : 'image/jpeg'),
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

        console.log(`✅ Success: ${itemName} updated with ${publicUrl}`);
        return true;
    } catch (err) {
        console.error(`❌ Failed for ${itemName}:`, err.message);
        return false;
    }
}

async function main() {
    const batch = [
        {
            "name": "Toilet Brush Round",
            "id": "6b42cd34-dc6d-4a63-a0c8-2396978f0cf6",
            "url": "https://5.imimg.com/data5/FO/OK/PK/SELLER-5785231/milton-round-toilet-brush.jpg"
        },
        {
            "name": "Air Freshner (R5)",
            "id": "4b0ef6e7-1ebf-4c7a-8b2c-52219b94e45e",
            "url": "https://5.imimg.com/data5/DQ/BP/DW/SELLER-50508704/liquid-air-freshener-500x500.jpg"
        },
        {
            "name": "Sanitizer",
            "id": "536bb01d-62e3-4131-a481-e9db4c4a3a91",
            "url": "https://5.imimg.com/data5/SELLER/Default/2022/4/AH/QU/UY/2964755/hand-sanitizer-can-5-ltr.jpg"
        },
        {
            "name": "Duster Green",
            "id": "06aaf364-8a9e-4b19-b624-f958c8e0de9e",
            "url": "https://5.imimg.com/data5/ECOM/Default/2025/2/490850016/YG/JB/TD/194362655/1696868543016-whatsappimage20231002at15742pm570x570-500x500.jpeg"
        },
        {
            "name": "Hand Gloves Orange",
            "id": "635a8a3f-0f00-42e4-a4ab-1d5fbd360ab3",
            "url": "https://5.imimg.com/data5/SELLER/Default/2024/9/453792236/AK/TG/WH/3422722/orange-industrial-rubber-hand-gloves.jpg"
        },
        {
            "name": "Dust Pan",
            "id": "fa9129a1-a8ec-44c8-bf4c-ef6f1a6a45a1",
            "url": "https://5.imimg.com/data5/AX/VK/EJ/SELLER-6438057/dustpan-with-brush-long-handle-500x500.jpg"
        },
        {
            "name": "Multi Purpose Cleaner (R2)",
            "id": "7fe3e7df-947f-4068-844d-c68600f3ee27",
            "url": "https://5.imimg.com/data5/ANDROID/Default/2025/11/559459010/HA/UE/MJ/44736104/product-jpeg.jpg"
        },
        {
            "name": "Milk in litre",
            "id": "acbb492b-a50c-4d24-8eff-bef20d930d91",
            "url": "https://5.imimg.com/data5/SELLER/Default/2021/1/AV/UW/KN/118764700/amul-toned-carton-500x500.jpg"
        },
        {
            "name": "R1",
            "id": "ad825817-974e-4aa9-873e-0f1bb3430164",
            "url": "https://5.imimg.com/data5/SELLER/Default/2021/3/KG/FI/GP/108491477/taski-r1.jpg"
        },
        {
            "name": "Aroma Oil ",
            "id": "0c1be282-278d-4ef8-b66f-74479f7abd95",
            "url": "https://5.imimg.com/data5/SELLER/Default/2022/4/AS/FJ/JB/236578/aroma-oil-1-ltr.jpg"
        }
    ];

    for (const item of batch) {
        await uploadImage(item.url, item.name, item.id);
    }
}

main();
