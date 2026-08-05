const fs = require('fs');
const path = require('path');

const srcNode = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node');
const distDir = path.join(__dirname, '../dist');
const destNode = path.join(distDir, 'better_sqlite3.node');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(srcNode)) {
  fs.copyFileSync(srcNode, destNode);
  console.log(`Copied better_sqlite3.node to dist/`);
} else {
  console.error(`better_sqlite3.node not found at ${srcNode}`);
  process.exit(1);
}
