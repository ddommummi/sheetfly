// 4-0 스파이크: rhwp(현재 배포 중인 뷰어 WASM 그대로)로 편집→저장→다시 열기가 되는지, 얼마나 걸리는지
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../../apps/web/src/wasm/', import.meta.url).pathname;
const { default: init, HwpDocument } = await import(dir + 'rhwp.js');
await init({ module_or_path: readFileSync(dir + 'rhwp_bg.wasm') });
const samples = new URL('../../third_party/rhwp/samples/', import.meta.url).pathname;
const files = process.argv.slice(2);
const T = (f) => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(samples + f));
  const out = { file: f, kb: Math.round(bytes.length / 1024) };
  try {
    const [d, tOpen] = T(() => new HwpDocument(bytes)); out.openMs = +tOpen.toFixed(0);
    out.pages = d.pageCount(); out.sections = d.getSectionCount();
    const text0 = d.getTextRange(0, 0, 0, 40); out.firstText = text0.slice(0, 30);
    // 커서·클릭 위치 변환
    const [cur, tCur] = T(() => JSON.parse(d.getCursorRect(0, 0, 0))); out.cursor = { page: cur.pageIndex ?? cur.page, x: Math.round(cur.x), y: Math.round(cur.y), h: Math.round(cur.height ?? cur.h ?? 0) }; out.cursorMs = +tCur.toFixed(2);
    const [hit, tHit] = T(() => JSON.parse(d.hitTest(0, cur.x + 3, cur.y + 3))); out.hit = hit; out.hitMs = +tHit.toFixed(2);
    // 입력: 맨 앞에 한글+영문
    const [ins, tIns] = T(() => d.insertText(0, 0, 0, '편집 시험 abc')); out.insertMs = +tIns.toFixed(1); out.insertRet = String(ins).slice(0, 80);
    out.pagesAfterInsert = d.pageCount();
    out.textAfter = d.getTextRange(0, 0, 0, 20);
    // 서식
    try { const [, t] = T(() => d.applyCharFormat(0, 0, 0, 5, JSON.stringify({ bold: true }))); out.fmtMs = +t.toFixed(1); } catch (e) { out.fmtErr = String(e).slice(0, 80); }
    // 되돌리기용 스냅샷
    try { const [id, t] = T(() => d.saveSnapshot()); out.snapshotMs = +t.toFixed(1); out.snapshotId = id; d.deleteText(0, 0, 0, 3); out.afterDelete = d.getTextRange(0, 0, 0, 10); d.restoreSnapshot(id); out.afterRestore = d.getTextRange(0, 0, 0, 10); } catch (e) { out.snapErr = String(e).slice(0, 100); }
    // 저장: HWP, HWPX, 보고서
    const [rep, tRep] = T(() => d.exportHwpVerify()); out.verifyMs = +tRep.toFixed(0); out.verify = rep.slice(0, 160);
    const [hwp, tHwp] = T(() => d.exportHwp()); out.exportHwpMs = +tHwp.toFixed(0); out.exportHwpKb = Math.round(hwp.length / 1024);
    const [d2, tRe] = T(() => new HwpDocument(new Uint8Array(hwp))); out.reopenMs = +tRe.toFixed(0); out.reopenPages = d2.pageCount(); out.reopenText = d2.getTextRange(0, 0, 0, 20);
    try { const [hx, t] = T(() => d.exportHwpx()); out.exportHwpxMs = +t.toFixed(0); out.exportHwpxKb = Math.round(hx.length / 1024); const d3 = new HwpDocument(new Uint8Array(hx)); out.hwpxReopenText = d3.getTextRange(0, 0, 0, 20); } catch (e) { out.hwpxErr = String(e).slice(0, 100); }
  } catch (e) { out.error = String(e).slice(0, 200); }
  console.log(JSON.stringify(out));
}
