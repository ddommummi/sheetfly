// 편집 시험에서 무엇이 달라졌는지: 원래 문단 조각과 새 문단 조각의 태그·속성 집합 차이를 모은다.
import { readFileSync } from 'node:fs';
import { readZip, readPart } from '../../edit-spike/docx-zip.mjs';
import { indexParagraphs } from '../../edit-spike/docx-xml.mjs';
import { parseDocx, saveDocx } from './work/out-node.mjs';
const rows = JSON.parse(readFileSync(new URL('out/edit-rows.json', import.meta.url))).filter((r) => r.ge?.ok && !r.ge.lossless);
const MARK = 'Ⅹ';
const tagsOf = (s) => { const m = {}; for (const t of s.matchAll(/<([A-Za-z][\w:.-]*)/g)) m[t[1]] = (m[t[1]] ?? 0) + 1; return m; };
const attrsOf = (s) => { const m = {}; for (const t of s.matchAll(/\s([A-Za-z][\w:.-]*)="/g)) m[t[1]] = (m[t[1]] ?? 0) + 1; return m; };
const lostTags = {}, gainedTags = {}, lostAttrs = {}, gainedAttrs = {}; let n = 0, onlyAttrs = 0, onlyRsid = 0, shown = 0;
const byDoc = new Map(); for (const r of rows) (byDoc.get(r.f) ?? byDoc.set(r.f, []).get(r.f)).push(r);
for (const [f, rs] of byDoc) {
  const buf = readFileSync(process.argv[2] + '/' + f);
  const doc = await parseDocx(new Uint8Array(buf)); const raw = doc.internal.documentXml; const els = doc.extras.elements;
  for (const r of rs) {
    const b = doc.blocks.find((x) => x.docxIndex === r.idx); const el = els[r.idx]; const oldP = raw.slice(el.start, el.end);
    const runs = JSON.parse(JSON.stringify(b.runs)); let k = runs.length - 1; while (k >= 0 && typeof runs[k].text !== 'string') k--; runs[k].text += MARK;
    const gen = { type: 'paragraph', styleId: b.styleId, list: b.list, format: b.format, rawPPr: b.rawPPr, bookmarks: b.bookmarks, hiddenBookmarks: b.hiddenBookmarks, commentStarts: b.commentStarts, commentEnds: b.commentEnds, runs };
    const out = await saveDocx(doc, doc.blocks.filter((x) => !x.hidden).map((x) => (x === b ? { kind: 'generated', block: gen, docxIndex: b.docxIndex } : { kind: 'original', docxIndex: x.docxIndex })), { savedAt: '2026-01-01T00:00:00Z' });
    const z = readZip(Buffer.from(out)); const nx = readPart(Buffer.from(out), z.entries.find((e) => e.name === 'word/document.xml')).toString('utf8');
    // 새 문단 조각: 앞 공통 + 같은 뒤 공통으로 잘라 낸다
    let i = 0; const m = Math.min(raw.length, nx.length); while (i < m && raw[i] === nx[i]) i++;
    let j = 0; while (j < m - i && raw[raw.length - 1 - j] === nx[nx.length - 1 - j]) j++;
    const oldW = raw.slice(Math.min(el.start, i), raw.length - j), newW = nx.slice(Math.min(el.start, i), nx.length - j);
    const ot = tagsOf(oldW), nt = tagsOf(newW), oa = attrsOf(oldW), na = attrsOf(newW);
    for (const t of Object.keys(ot)) if ((nt[t] ?? 0) < ot[t]) lostTags[t] = (lostTags[t] ?? 0) + (ot[t] - (nt[t] ?? 0));
    for (const t of Object.keys(nt)) if ((ot[t] ?? 0) < nt[t]) gainedTags[t] = (gainedTags[t] ?? 0) + (nt[t] - (ot[t] ?? 0));
    for (const t of Object.keys(oa)) if ((na[t] ?? 0) < oa[t]) lostAttrs[t] = (lostAttrs[t] ?? 0) + (oa[t] - (na[t] ?? 0));
    for (const t of Object.keys(na)) if ((oa[t] ?? 0) < na[t]) gainedAttrs[t] = (gainedAttrs[t] ?? 0) + (na[t] - (oa[t] ?? 0));
    const tagsSame = JSON.stringify(Object.entries(ot).sort()) === JSON.stringify(Object.entries(nt).sort());
    if (tagsSame) onlyAttrs++;
    const lostA = Object.keys(oa).filter((a) => (na[a] ?? 0) < oa[a]);
    if (tagsSame && lostA.every((a) => /rsid|paraId|textId/i.test(a))) onlyRsid++;
    n++;
    if (shown < 2 && !tagsSame) { shown++; console.log('--- 예', f.split('/').pop(), 'idx', r.idx, '\n원래:', oldW.slice(0, 420), '\n새  :', newW.slice(0, 420)); }
  }
}
const top = (o, k = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k);
console.log(`\n무손실 아닌 시험 ${n}건 중 태그 구성은 같고 속성만 달라진 것 ${onlyAttrs}건 (그중 rsid/paraId류만 달라진 것 ${onlyRsid}건)`);
console.log('빠진 태그 전체:', JSON.stringify(top(lostTags, 40)));
console.log('생긴 태그:', top(gainedTags));
console.log('빠진 속성:', top(lostAttrs, 12));
console.log('생긴 속성:', top(gainedAttrs, 8));
