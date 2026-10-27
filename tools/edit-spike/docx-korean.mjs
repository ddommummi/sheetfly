// 폴더의 모든 docx에서 한글(U+AC00–D7A3) 글자 수와 Word 구조 단서(줄 격자·필드·표·한글 글꼴)를 센다. 한국어 시험 문서를 고를 때 쓴다.
//   node tools/edit-spike/docx-korean.mjs <폴더…>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, readPart } from './docx-zip.mjs';
const roots = process.argv.slice(2);
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.git') continue; const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|dotx|docm)$/i.test(e.name)) yield p; } }
const H = /[가-힣]/g;
const rows = [];
for (const root of roots) for (const f of walk(root)) {
  let buf; try { buf = readFileSync(f); } catch { continue; }
  let z; try { z = readZip(buf); } catch { continue; }
  let hangul = 0, xml = '';
  for (const e of z.entries) { if (!/^word\/(document|header\d*|footer\d*|footnotes)\.xml$/.test(e.name) || (e.flags & 1)) continue; try { const t = readPart(buf, e).toString('utf8'); if (e.name === 'word/document.xml') xml = t; hangul += (t.match(H) ?? []).length; } catch {} }
  const app = z.entries.find((e) => e.name === 'docProps/app.xml'); let producer = '';
  if (app) try { producer = (readPart(buf, app).toString('utf8').match(/<Application>([^<]*)</) ?? [])[1] ?? ''; } catch {}
  rows.push({ f: f.slice(root.length + 1), root: root.split('/').slice(-2).join('/'), size: buf.length, hangul, producer,
    docGridLines: /<w:docGrid\b[^>]*w:type="(lines|linesAndChars|snapToChars)"/.test(xml), field: /<w:fldChar\b|<w:fldSimple\b/.test(xml), table: /<w:tbl>/.test(xml), eastAsia: /w:eastAsia="[^"]*(맑은|바탕|굴림|돋움|Malgun|Batang|Gulim|Dotum|함초롬|HCR)/.test(xml) });
}
const k = rows.filter((r) => r.hangul > 0);
console.log(`전체 ${rows.length}개 중 한글이 든 파일 ${k.length}개`);
const byRoot = {}; for (const r of k) (byRoot[r.root] ??= []).push(r);
for (const [root, rs] of Object.entries(byRoot)) { console.log(`\n## ${root}: ${rs.length}개`); for (const r of rs.sort((a, b) => b.hangul - a.hangul).slice(0, 25)) console.log(`  한글 ${String(r.hangul).padStart(6)}자  ${String(Math.round(r.size / 1024)).padStart(5)}KB  ${[r.docGridLines && '줄격자', r.field && '필드', r.table && '표', r.eastAsia && '한글글꼴'].filter(Boolean).join(',').padEnd(18)} ${r.producer.slice(0, 22).padEnd(22)} ${r.f}`); }
