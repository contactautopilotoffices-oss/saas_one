const fs = require('fs');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..');
const KNOWLEDGE_DIR = path.join(REPO_DIR, 'knowledge');

// Create directories
const dirs = [
  path.join(KNOWLEDGE_DIR, 'db_schema'),
  path.join(KNOWLEDGE_DIR, 'architecture'),
  path.join(KNOWLEDGE_DIR, 'conventions'),
  path.join(KNOWLEDGE_DIR, 'history')
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Helper to get all files
function walkSync(currentDirPath, callback) {
    fs.readdirSync(currentDirPath).forEach(function (name) {
        var filePath = path.join(currentDirPath, name);
        var stat = fs.statSync(filePath);
        if (stat.isFile()) {
            callback(filePath, stat);
        } else if (stat.isDirectory() && name !== 'node_modules' && name !== '.git' && name !== '.next') {
            walkSync(filePath, callback);
        }
    });
}

// 1. Generate File Tree
console.log('📂 Generating Project File Tree...');
let fileTree = '';
walkSync(REPO_DIR, (filePath) => {
    fileTree += filePath.replace(REPO_DIR, '') + '\n';
});
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'architecture', 'file_tree.txt'), fileTree);
console.log('✅ File tree saved.');

// 2. Map API Routes
console.log('🔌 Mapping API Routes...');
let apiRoutes = 'API Routes found in the repository:\n\n';
const apiDir = path.join(REPO_DIR, 'app', 'api');
if (fs.existsSync(apiDir)) {
    walkSync(apiDir, (filePath) => {
        if (filePath.endsWith('route.ts') || filePath.endsWith('route.js')) {
            apiRoutes += filePath.replace(REPO_DIR, '') + '\n';
        }
    });
} else {
    apiRoutes += 'No app/api directory found.\n';
}
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'architecture', 'api_routes.txt'), apiRoutes);
console.log('✅ API routes saved.');

// 3. Map Components
console.log('🧩 Mapping Frontend Components...');
let components = 'React Components found in the repository:\n\n';
const compDir = path.join(REPO_DIR, 'frontend', 'components');
if (fs.existsSync(compDir)) {
    walkSync(compDir, (filePath) => {
        if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
            components += filePath.replace(REPO_DIR, '') + '\n';
        }
    });
} else {
    components += 'No frontend/components directory found.\n';
}
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'architecture', 'components.txt'), components);
console.log('✅ Components mapped.');

console.log('✨ Local Knowledge Sync Complete!');
