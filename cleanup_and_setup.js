const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const serverPath = path.join(root, 'server');
const routesPath = path.join(serverPath, 'routes');
const dataPath = path.join(serverPath, 'data');
const publicPath = path.join(root, 'public');
const cachePath = path.join(root, '.wwebjs_cache');

console.log('🔧 מתחיל ניקוי והכנת המבנה...\n');

// מחיקת קבצים תקולים
function forceDelete(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
  console.log(`✓ נמחק: ${targetPath}`);
}

// מחק קבצים תקולים ב-server
forceDelete(routesPath);
forceDelete(dataPath);

// יצור תיקיות נכונות
fs.mkdirSync(publicPath, { recursive: true });
fs.mkdirSync(routesPath, { recursive: true });
fs.mkdirSync(dataPath, { recursive: true });
console.log('✓ יוצרו תיקיות: public, server/routes, server/data\n');

// העתק קבצי frontend מ-cache
const frontendFiles = [
  { from: 'index.html', to: 'public/index.html' },
  { from: 'style.css', to: 'public/style.css' },
  { from: 'app.js', to: 'public/app.js' }
];

console.log('📂 מעתיק קבצי Frontend:\n');
frontendFiles.forEach(({ from, to }) => {
  const fromPath = path.join(cachePath, from);
  const toPath = path.join(root, to);
  if (fs.existsSync(fromPath)) {
    fs.copyFileSync(fromPath, toPath);
    console.log(`✓ ${from} -> ${to}`);
  } else {
    console.log(`⚠ לא נמצא: ${from}`);
  }
});

console.log('\n✅ סיימנו ניקוי והכנת המבנה!\n');
