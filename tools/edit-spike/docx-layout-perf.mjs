import { makeDocx, p } from '../../apps/web/tests/docx-fixtures.mjs';
import { irOf } from './docx-ir.mjs';
const mod = await import('../../apps/web/src/docx/index.js');
const { layoutDocument } = mod; const measure = (await import('../../apps/web/src/docx/measure.js')).createFakeMeasurer();
for (const n of [100, 1000, 5000]) {
  const body = Array.from({ length: n }, (_, i) => p(`문단 ${i} 가나다라마바사 아자차카타파하 ` + 'lorem ipsum '.repeat(10))).join('');
  const ir = irOf(makeDocx(body));
  const t = performance.now(); const pages = layoutDocument(ir.ir, measure, { headingRuns: ir.heading_runs }); const dt = performance.now() - t;
  const t2 = performance.now(); layoutDocument(ir.ir, measure, { headingRuns: ir.heading_runs }); const dt2 = performance.now() - t2;
  console.log(`문단 ${n}: ${pages.length}쪽, 전체 조판 ${dt.toFixed(0)}ms(첫 번째) / ${dt2.toFixed(0)}ms(두 번째, 글자 폭 캐시 따뜻), 쪽당 ${(dt2 / pages.length).toFixed(2)}ms`);
}
