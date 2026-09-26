'use strict';
// Copies the CRM app into electron/app so electron-builder packages it.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const SRC = path.resolve(__dirname, '..');
const DST = path.join(__dirname, 'app');
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });
const cp = (rel) => execSync(process.platform === 'win32'
  ? `xcopy /E /I /Y /Q "${path.join(SRC, rel)}" "${path.join(DST, rel)}"`
  : `cp -r "${path.join(SRC, rel)}" "${path.join(DST, rel)}"`, { stdio: 'inherit' });
for (const rel of ['server', 'public', 'package.json', 'package-lock.json', 'node_modules']) {
  if (fs.existsSync(path.join(SRC, rel))) cp(rel);
}
if (fs.existsSync(path.join(SRC, '.env'))) cp('.env');
console.log('app copied to electron/app');
