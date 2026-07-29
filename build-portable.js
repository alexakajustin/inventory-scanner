const fs = require('fs');
const path = require('path');
const https = require('https');
const archiver = require('archiver');

const RELEASE_DIR = path.join(__dirname, 'Inventory-Scanner-Windows');
const ZIP_PATH = path.join(__dirname, 'Inventory-Scanner-Windows.zip');

// Node.js v20 LTS standalone executable URL for Windows x64
const NODE_EXE_URL = 'https://nodejs.org/dist/v20.11.1/win-x64/node.exe';

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        https.get(response.headers.location, (res) => {
          res.pipe(file);
          file.on('finish', () => { file.close(resolve); });
        }).on('error', (err) => { fs.unlink(dest, () => reject(err)); });
      } else {
        response.pipe(file);
        file.on('finish', () => { file.close(resolve); });
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  const entries = fs.readdirSync(from, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);

    if (entry.isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function build() {
  console.log('🧹 Curățare directoare vechi...');
  if (fs.existsSync(RELEASE_DIR)) fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
  if (fs.existsSync(ZIP_PATH)) fs.rmSync(ZIP_PATH, { force: true });

  fs.mkdirSync(RELEASE_DIR);

  console.log('⬇️ Se descarcă Node.js (asta poate dura câteva secunde)...');
  await downloadFile(NODE_EXE_URL, path.join(RELEASE_DIR, 'node.exe'));

  console.log('📁 Se copiază fișierele aplicației...');
  const filesToCopy = [
    'server.js',
    'db.js',
    'generate-cert.js',
    'package.json'
  ];

  for (const file of filesToCopy) {
    if (fs.existsSync(path.join(__dirname, file))) {
      fs.copyFileSync(path.join(__dirname, file), path.join(RELEASE_DIR, file));
    }
  }

  // Copy folders
  console.log('📁 Se copiază folderul public...');
  copyFolderSync(path.join(__dirname, 'public'), path.join(RELEASE_DIR, 'public'));
  
  console.log('📁 Se copiază node_modules...');
  copyFolderSync(path.join(__dirname, 'node_modules'), path.join(RELEASE_DIR, 'node_modules'));

  console.log('⚙️ Se creează scriptul start.bat...');
  const batContent = `
@echo off
title Snipe-IT Barcode Scanner Server
echo ===================================================
echo Pornire Server (Nu inchide aceasta fereastra)
echo ===================================================
cd /d "%~dp0"
node.exe server.js
pause
  `.trim();
  fs.writeFileSync(path.join(RELEASE_DIR, 'start.bat'), batContent);

  console.log(`\n✅ GATA! Folderul portabil a fost creat la:`);
  console.log(`👉 ${RELEASE_DIR}`);
  console.log(`Pornesc arhivarea PowerShell...`);
}

build().catch(console.error);
