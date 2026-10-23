// ge-rows.json(docx-engine) + oo-rows.json(office_oxide IR + P2)을 파일 이름으로 합쳐 표를 낸다. (v2)
import { readFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url);
const ge = JSON.parse(readFileSync(new URL('out/ge-rows.json', dir)));
const oo = JSON.parse(readFileSync(new URL('out/oo-rows.json', dir)));
const ooBy = new Map(oo.map((r) => [r.f, r]));
const all = ge.filter((r) => r.ge?.ok && ooBy.get(r.f)?.oo?.ok).map((r) => ({ ...r, oo: ooBy.get(r.f).oo }));
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
const norm = all.filter((r) => r.xml.normalized);
console.log(`## 두 엔진이 모두 연 문서 ${all.length}개 (그중 ISO Strict 네임스페이스라 엔진이 Transitional로 바꾼 문서 ${norm.length}개)\n`);

// ---------- (a) 기능 보존 ----------
const FEATS = ['field', 'revision', 'comment', 'noteRef', 'columns', 'docGrid', 'floating', 'inlineDrawing', 'textbox', 'math', 'chart', 'sdt', 'header', 'footer', 'numbering', 'hyperlink', 'tab', 'ruby', 'symbol', 'multiSection'];
console.log('### (a) 기능 보존: XML에 있는 문서 중 모델이 "구조로" 내는 문서 (docx-engine 괄호 안은 구조로는 없지만 원문 조각은 보존한 문서)');
console.log('| 기능 | XML에 있는 문서 | IR(office_oxide) | docx-engine 구조 | (+원문만 보존) |');
console.log('|---|---:|---:|---:|---:|');
for (const k of FEATS) {
  const withX = all.filter((r) => r.xml.feat[k]); if (!withX.length) continue;
  const o = withX.filter((r) => r.oo.feat[k]).length, g = withX.filter((r) => r.ge.feat[k]).length;
  const p = withX.filter((r) => !r.ge.feat[k] && r.ge.preserved[k]).length;
  console.log(`| ${k} | ${withX.length} | ${o} (${pct(o, withX.length)}) | ${g} (${pct(g, withX.length)}) | ${p ? '+' + p : ''} |`);
}
console.log('\n탐지기 점검(XML 탐지기에는 없는데 모델이 낸 문서 수; 0에 가까울수록 탐지가 신뢰할 만함):');
for (const k of FEATS) {
  const fo = all.filter((r) => !r.xml.feat[k] && r.oo.feat[k]).length, fg = all.filter((r) => !r.xml.feat[k] && r.ge.feat[k]).length;
  if (fo || fg) console.log(`  ${k}: IR ${fo}, docx-engine ${fg}`);
}

// ---------- (b1) 앵커 일관성 ----------
console.log('\n### (b1) 앵커 일관성: block.originalXml == 엔진 기준 XML[요소 범위[docxIndex]]');
const A = all.reduce((a, r) => ({ anchored: a.anchored + r.ge.anchored, exact: a.exact + r.ge.exact, sdt: a.sdt + r.ge.sdtWrapped, badDocs: a.badDocs + (r.ge.anchored !== r.ge.exact ? 1 : 0) }), { anchored: 0, exact: 0, sdt: 0, badDocs: 0 });
console.log(`앵커 있는 블록 ${A.anchored}개 중 일치 ${A.exact}개 (${pct(A.exact, A.anchored)}); 불일치 ${A.anchored - A.exact}개(그중 SDT로 감싼 블록 ${A.sdt}개), 불일치가 있는 문서 ${A.badDocs}개`);
const bad = all.filter((r) => r.ge.anchored !== r.ge.exact).slice(0, 6).map((r) => `${r.f.split('/').pop()} 불일치 ${r.ge.anchored - r.ge.exact} (SDT ${r.ge.sdtWrapped}) 첫 사례 ${JSON.stringify(r.ge.firstBad)}`);
if (bad.length) console.log('불일치 문서 예:\n  ' + bad.join('\n  '));
console.log(`ISO Strict → Transitional 치환으로 원본 바이트와 달라진 문서: ${norm.length}개`);

// ---------- (b2) 글 문단 → 되돌아갈 수 있는 비율 ----------
function table(rows, title) {
  console.log(`\n### (b2) ${title}`);
  console.log('| 분류 | XML 글 문단 | docx-engine: 편집 블록 | docx-engine: 표 모델 | docx-engine: 표시용·보호 | 블록 없음 | P2: 짝+편집 가능 | P2: 짝+잠금 | P2: 짝 못함 |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  const T = { n: 0, e: 0, t: 0, p: 0, z: 0, pe: 0, pl: 0, pu: 0 };
  for (const c of ['body', 'table', 'sdt', 'textbox', 'other']) {
    const s = { n: 0, e: 0, t: 0, p: 0, z: 0, pe: 0, pl: 0, pu: 0 };
    for (const r of rows) {
      const g = r.ge.cover[c]; if (g) { s.n += g.n; s.e += g.editable; s.t += g.tableModel; s.p += g.protectedBlock + g.textboxDisplay; s.z += g.none; }
      const o = r.oo.cats[c]; if (o) { s.pe += o.mappedEditable; s.pl += o.mappedLocked; s.pu += o.unmapped; }
    }
    for (const k of Object.keys(T)) T[k] += s[k];
    if (s.n) console.log(`| ${c} | ${s.n} | ${s.e} (${pct(s.e, s.n)}) | ${s.t} (${pct(s.t, s.n)}) | ${s.p} (${pct(s.p, s.n)}) | ${s.z} (${pct(s.z, s.n)}) | ${s.pe} (${pct(s.pe, s.n)}) | ${s.pl} (${pct(s.pl, s.n)}) | ${s.pu} (${pct(s.pu, s.n)}) |`);
  }
  console.log(`| **합계** | ${T.n} | ${T.e} (${pct(T.e, T.n)}) | ${T.t} (${pct(T.t, T.n)}) | ${T.p} (${pct(T.p, T.n)}) | ${T.z} (${pct(T.z, T.n)}) | ${T.pe} (${pct(T.pe, T.n)}) | ${T.pl} (${pct(T.pl, T.n)}) | ${T.pu} (${pct(T.pu, T.n)}) |`);
  return T;
}
const nOf = (o) => Object.values(o).reduce((a, c) => a + c.n, 0);
const visible = all.filter((r) => nOf(r.oo.cats) > 0 || nOf(r.ge.cover) === 0), blind = all.filter((r) => !(nOf(r.oo.cats) > 0 || nOf(r.ge.cover) === 0));
table(visible, `P2 도구가 문단을 보는 문서 ${visible.length}개 (같은 조건 비교)`);
if (blind.length) console.log(`\n(참고) P2 XML 도구가 문단을 못 보는 문서 ${blind.length}개: docx-engine이 보는 글 문단 ${blind.reduce((a, r) => a + nOf(r.ge.cover), 0)}개, P2 도구 0개`);
const plain2 = visible;
// P2 짝 못한 문단의 집중도
const un = plain2.map((r) => ({ f: r.f.split('/').pop(), u: Object.values(r.oo.cats).reduce((a, c) => a + c.unmapped, 0), n: Object.values(r.oo.cats).reduce((a, c) => a + c.n, 0) })).sort((a, b) => b.u - a.u);
const totU = un.reduce((a, b) => a + b.u, 0);
let cum = 0; const top10 = un.slice(0, 10).map((d) => (cum += d.u, d));
console.log(`\nP2 짝 못함 ${totU}개 중 상위 10개 문서가 ${cum}개 (${pct(cum, totU)}). 상위: ` + un.slice(0, 5).map((d) => `${d.f} ${d.u}/${d.n}`).join(', '));
const un0 = un.filter((d) => d.u === 0).length; console.log(`짝 못함이 0인 문서 ${un0}/${un.length}`);

// ---------- 시간 ----------
const q = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * p)];
const gms = all.map((r) => r.ge.ms), oms = all.map((r) => r.oo.ms);
console.log('\n### 읽기 시간(ms, Node 22, 첫 호출 포함)');
console.log(`| | p50 | p95 | 최대 | 합계 |\n|---|---:|---:|---:|---:|\n| office_oxide IR(WASM, JSON 직렬화 포함) | ${q(oms, .5)} | ${q(oms, .95)} | ${Math.max(...oms)} | ${Math.round(oms.reduce((a, b) => a + b, 0))} |\n| docx-engine parseDocx(JS) | ${q(gms, .5)} | ${q(gms, .95)} | ${Math.max(...gms)} | ${Math.round(gms.reduce((a, b) => a + b, 0))} |`);
const slow = all.slice().sort((a, b) => b.ge.ms - a.ge.ms).slice(0, 3).map((r) => `${r.f.split('/').pop()} (${r.ge.ms}ms vs IR ${r.oo.ms}ms, XML ${(r.xml.len / 1e6).toFixed(1)}MB)`);
console.log('docx-engine 가장 느린 3개: ' + slow.join('; '));
const bt = {}; for (const r of all) for (const [k, v] of Object.entries(r.ge.byType)) bt[k] = (bt[k] ?? 0) + v;
console.log('\ndocx-engine 블록 종류 합계', JSON.stringify(bt));
