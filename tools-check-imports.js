// Verify all relative imports resolve to real files and real exports.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'public', 'js');

function walk(d) {
  let out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const exps = new Set();
  const re = /export\s+(?:async\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src))) exps.add(m[1]);
  const re2 = /export\s*\{([^}]+)\}/g;
  while ((m = re2.exec(src))) m[1].split(',').forEach((s) => {
    const n = s.trim().split(/\s+as\s+/).pop().trim();
    if (n) exps.add(n);
  });
  return exps;
}

const files = walk(root).filter((f) => !f.includes(path.sep + 'vendor' + path.sep));
const impRe = /import\s*(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}\s*)?(?:from\s+)?['"]([^'"]+)['"]/g;
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  impRe.lastIndex = 0;
  while ((m = impRe.exec(src))) {
    const spec = m[3];
    if (!spec || !spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) {
      console.log('MISSING FILE:', f, '->', spec); bad++; continue;
    }
    const names = m[2] ? m[2].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : [];
    if (!names.length) continue;
    const exps = exportsOf(target);
    for (const n of names) if (!exps.has(n) && n !== 'default') {
      console.log('MISSING EXPORT:', f, '->', n, 'from', spec); bad++;
    }
  }
}
console.log(bad === 0 ? 'ALL IMPORTS OK' : bad + ' problems found');
