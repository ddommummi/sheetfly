// 정답 파일(GenOffice truths)을 우리 어댑터(fmt-docx WASM)로 읽어 IR JSON으로 내보낸다. GENOFFICE_DIR 필요.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { irOf } from '../../../edit-spike/docx-ir.mjs';
const T = (process.env.GENOFFICE_DIR ?? (() => { throw new Error('GENOFFICE_DIR에 genspark-ai/genoffice 체크아웃 경로를 지정한다'); })()) + '/packages/docx-engine/tests/fixtures/truths/';
const out = new URL('../out/lineheight/ir/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const d of ['malgun-line-pitch-sizes', 'cjk-face-factors']) {
  const full = irOf(readFileSync(T + d + '/probe.docx'));
  writeFileSync(new URL(`${d}.json`, out), JSON.stringify(full));
  console.log(d, '구역', full.ir.sections.length, '요소', full.ir.sections.map((s) => s.elements.length).join(','));
}
