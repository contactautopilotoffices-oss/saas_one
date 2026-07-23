
const { execSync } = require('child_process');

const items = [
  {
    "name": "Furniture Polish (R4)",
    "id": "57a2025e-9139-4f12-b029-9dc35fee7468",
    "imageUrl": "https://m.media-amazon.com/images/I/61NIi8DfaJL.jpg"
  },
  {
    "name": "Steal Polish (R7)",
    "id": "60122ccf-ccdc-4fdf-b9d7-62e924386645",
    "imageUrl": "https://m.media-amazon.com/images/I/31FDlk0gkvL._AC_UF1000%2C1000_QL80_.jpg"
  },
  {
    "name": "Dish Wash Liquid",
    "id": "a488fbf5-76f6-4228-b6a2-d5dfd0bad91a",
    "imageUrl": "https://m.media-amazon.com/images/I/51HtsznfRgL.jpg"
  },
  {
    "name": "Hand Washing Liquid",
    "id": "635fcdc1-b9fc-422c-88d4-093fc4d155c5",
    "imageUrl": "https://m.media-amazon.com/images/I/41K-Azn1OuL._AC_UF1000%2C1000_QL80_.jpg"
  },
  {
    "name": "500 Ml Water Bottle",
    "id": "8d65406a-0ff2-4b6d-86d2-8331420198c8",
    "imageUrl": "https://m.media-amazon.com/images/I/61AeDsKQjmL.jpg"
  }
];

for (const item of items) {
    console.log(`Uploading ${item.name}...`);
    try {
        execSync(`node scripts/upload_generated.js "${item.imageUrl}" "${item.name}" "${item.id}"`, { stdio: 'inherit' });
    } catch (e) {
        console.error(`Error uploading ${item.name}:`, e.message);
    }
}
