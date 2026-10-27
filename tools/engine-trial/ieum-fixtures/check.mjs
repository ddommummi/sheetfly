// 이음오피스(pblsketch/openoffice, Apache-2.0)의 한글 2024 저장 재현 파일 4개로, 레이아웃 관계 검사(좌표 값이 아니라 위아래 관계)를 한 엔진에 돌린다.
//   node check.mjs <rhwp.js 글루> <rhwp_bg.wasm> <fixtures 폴더>
// 검사 내용은 apps/hwp/tests/engine-layout.test.ts의 단언을 plain 코드로 옮긴 것이다(그쪽 시험이 원본). 이 스크립트는 받아 온 외부 WASM 빌드를 실행한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [gluePath, wasmPath, fxDir] = process.argv.slice(2);
if (!gluePath || !wasmPath || !fxDir) { console.error('사용: node check.mjs <rhwp.js> <rhwp_bg.wasm> <fixtures 폴더>'); process.exit(2); }
const { default: init, HwpDocument } = await import(pathToFileURL(gluePath).href);
await init({ module_or_path: readFileSync(wasmPath) });
const open = (n) => new HwpDocument(new Uint8Array(readFileSync(join(fxDir, n))));
const boxes = (doc, page) => {
  const out = [];
  const walk = (node) => {
    if (node.pi !== undefined && node.pi < 1e9 && node.bbox && ['Table', 'Image', 'TextLine'].includes(node.type)) out.push({ type: node.type, pi: node.pi, top: node.bbox.y, bottom: node.bbox.y + node.bbox.h });
    if (node.type !== 'Table') for (const c of node.children ?? []) walk(c);
  };
  walk(JSON.parse(doc.getPageRenderTree(page)));
  return out;
};
const footnoteAndBody = (doc, page) => {
  const root = JSON.parse(doc.getPageRenderTree(page));
  const area = root.children?.find((c) => c.type === 'FootnoteArea');
  const separator = area?.children?.find((c) => c.type === 'Line')?.bbox?.y;
  const bottoms = [];
  const walk = (n) => { if (n.type === 'TextLine' && n.bbox) bottoms.push(n.bbox.y + n.bbox.h); else if (n.type !== 'Table') for (const c of n.children ?? []) walk(c); };
  for (const b of root.children?.filter((c) => c.type === 'Body') ?? []) walk(b);
  return { separator, bottoms };
};
const seq = (arr) => { for (let i = 1; i < arr.length; i++) if (arr[i].top < arr[i - 1].bottom - 0.5) return false; return true; };
const res = {};
const check = (name, fn) => { try { const fails = []; fn((cond, msg) => { if (!cond) fails.push(msg); }); res[name] = fails.length ? { ok: false, fails } : { ok: true }; } catch (e) { res[name] = { ok: false, fails: ['예외: ' + String(e.message ?? e).slice(0, 80)] }; } };

check('paper-square-table-tac-host (패치 0001)', (ex) => {
  const doc = open('paper-square-table-tac-host.hwpx'); ex(doc.pageCount() === 1, `쪽 수 ${doc.pageCount()} (기대 1)`);
  const page = boxes(doc, 0); const host = page.filter((b) => b.type === 'Table' && b.pi === 0).sort((a, b) => a.top - b.top);
  ex(host.length === 2, `문단0 표 ${host.length}개 (기대 2)`); if (host.length !== 2) return;
  const [sq, inl] = host; const need = sq.bottom + (4251 * 96) / 7200 - 0.5;
  ex(inl.top >= need, `글자처럼 취급 표가 어울림 표 아래로 안 내려감: top ${inl.top.toFixed(1)} < ${need.toFixed(1)}`);
  const after = page.filter((b) => b.pi > 0).sort((a, b) => a.top - b.top);
  ex(after.every((b) => b.top >= inl.bottom - 0.5), '뒤 문단이 표 높이만큼 올라와 겹침'); ex(seq(after), '뒤 문단끼리 겹침');
  const { separator, bottoms } = footnoteAndBody(doc, 0); ex(separator !== undefined, '각주 구분선 없음');
  ex(bottoms.every((b) => b <= separator + 0.5), '본문 마지막 줄이 각주 구분선과 겹침');
});
check('title-table-then-inline-table (패치 0004·0008)', (ex) => {
  const doc = open('title-table-then-inline-table.hwpx'); ex(doc.pageCount() === 1, `쪽 수 ${doc.pageCount()} (기대 1)`);
  const page = boxes(doc, 0); const sq = page.find((b) => b.type === 'Table' && b.pi === 0), inl = page.find((b) => b.type === 'Table' && b.pi === 1);
  ex(!!sq && !!inl, '표를 못 찾음'); if (!sq || !inl) return;
  const want = sq.bottom + ((4251 + 1600) * 96) / 7200; ex(Math.abs(inl.top - want) < 0.5, `둘째 표 위치 ${inl.top.toFixed(1)} (기대 ${want.toFixed(1)})`);
  const after = page.filter((b) => b.pi > 1).sort((a, b) => a.top - b.top); ex(after.length > 0 && after.every((b) => b.top >= inl.bottom - 0.5), '뒤 문단이 둘째 표를 덮음'); ex(seq(after), '뒤 문단끼리 겹침');
});
check('title-table-zone-fill (패치 0009)', (ex) => {
  const doc = open('title-table-zone-fill.hwpx'); const tables = [];
  const walk = (n) => { if (n.type === 'Table' && n.pi === 0) tables.push(n); else for (const c of n.children ?? []) walk(c); }; walk(JSON.parse(doc.getPageRenderTree(0)));
  const title = tables.sort((a, b) => a.bbox.y - b.bbox.y)[0]; const row = title.children.find((c) => c.type === 'Cell' && c.row === 1).bbox;
  const zone = title.children.find((c) => c.type === 'Rect' && Math.abs(c.bbox.y - row.y) < 0.5)?.bbox; ex(!!zone, '셀 영역 배경 없음'); if (!zone) return;
  ex(Math.abs(zone.x - title.bbox.x) < 0.5, '배경 왼쪽 끝'); ex(Math.abs(zone.x + zone.w - (title.bbox.x + title.bbox.w)) < 0.5, `배경 오른쪽 끝이 표 끝에 못 미침: ${(zone.x + zone.w).toFixed(1)} vs ${(title.bbox.x + title.bbox.w).toFixed(1)}`);
});
check('square-picture-after-page-reset (패치 0002)', (ex) => {
  const doc = open('square-picture-after-page-reset.hwpx'); ex(doc.pageCount() === 2, `쪽 수 ${doc.pageCount()} (기대 2)`); if (doc.pageCount() < 2) return;
  const [f, s] = [boxes(doc, 0), boxes(doc, 1)]; const lines = (p) => p.filter((b) => b.type === 'TextLine' && b.pi === 10);
  ex(lines(f).length === 2 && lines(s).length === 2, `문단10 줄 ${lines(f).length}+${lines(s).length} (기대 2+2)`);
  ex(!f.some((b) => b.type === 'Image'), '그림이 첫 쪽에 그려짐'); const pic = s.filter((b) => b.type === 'Image' && b.pi === 10); ex(pic.length === 1, `둘째 쪽 그림 ${pic.length}개 (기대 1)`);
  if (pic.length === 1) ex(pic[0].top >= Math.max(...lines(s).map((b) => b.bottom)) - 0.5, '그림이 줄 위에 겹침');
});
console.log(JSON.stringify(res, null, 1));
