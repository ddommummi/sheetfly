import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { irOf } from '../../edit-spike/docx-ir.mjs';
const dir = process.argv[2];
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
const types = {}, keysByType = {}, topKeys = {}, secKeys = {};
let n = 0;
for (const f of walk(dir)) {
  if (statSync(f).size > 25e6) continue;
  let ir; try { ir = irOf(readFileSync(f)); } catch { continue; }
  n++;
  for (const k of Object.keys(ir.ir)) topKeys[k] = (topKeys[k] ?? 0) + 1;
  for (const s of ir.ir.sections ?? []) for (const k of Object.keys(s)) secKeys[k] = (secKeys[k] ?? 0) + 1;
  const visit = (o, parent) => {
    if (Array.isArray(o)) { o.forEach((x) => visit(x, parent)); return; }
    if (o && typeof o === 'object') {
      if (typeof o.type === 'string') { types[o.type] = (types[o.type] ?? 0) + 1; const kk = (keysByType[o.type] ??= {}); for (const k of Object.keys(o)) kk[k] = (kk[k] ?? 0) + 1; }
      for (const v of Object.values(o)) visit(v, o);
    }
  };
  visit(ir.ir);
}
console.log('docs', n);
console.log('IR top keys', topKeys);
console.log('section keys', secKeys);
console.log('type counts', Object.entries(types).sort((a, b) => b[1] - a[1]));
for (const [t, kk] of Object.entries(keysByType)) console.log(t.padEnd(14), Object.keys(kk).join(','));
