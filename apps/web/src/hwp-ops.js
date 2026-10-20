// HWP 편집 확장 작업(Worker 쪽): 표·개체·쪽·머리글·각주·필드 등 rhwp API를 편집기에 노출한다. hwp-edit.js의 run()이 모르는 op를 여기로 넘긴다.
// 대부분의 API는 인자만 다를 뿐 "문서를 바꾸고 화면을 갱신한다"는 흐름이 같아서, 허용 목록(MUT·QRY)에 든 API 이름만 부르는 범용 작업(api·q)을 둔다.
// 목록 밖 이름은 거부한다(편집기 코드가 만든 요청만 오지만, 문서 상태를 바꾸는 API를 명시적으로 제한해 둔다).
// 표는 최상위 표(위치 path 길이 1)만 구조 편집한다 — 중첩 표 안의 칸 글 편집은 기존 입력 경로가 한다.

/** 문서를 바꾸는 API. */
export const MUT = new Set([
  // 표
  'createTable', 'createTableEx', 'insertTableRow', 'insertTableColumn', 'deleteTableRow', 'deleteTableColumn', 'mergeTableCells', 'splitTableCell', 'splitTableCellInto',
  'splitTableCellsInRange', 'deleteTableControl', 'setTableProperties', 'setCellProperties', 'setCellZoneProperties', 'resizeTableCells', 'splitTable', 'mergeTableWithNext',
  'transposeTableCellsInPlace', 'moveTableOffset', 'deleteCellTableControlByPath', 'evaluateTableFormula',
  // 개체(그림·도형·수식). 개체 앞뒤 순서는 changeShapeZOrder를 쓴다(…ControlAt 계열 중 setControlZOrderAt은 wasm이 죽는다).
  'insertPicture', 'setPictureProperties', 'deletePictureControl', 'assignPictureImage', 'createShapeControl', 'setShapeProperties', 'deleteShapeControl', 'changeShapeZOrder',
  // 쪽·구역·머리글·각주
  'setPageDef', 'setSectionDef', 'insertPageBreak', 'insertColumnBreak', 'setColumnDef', 'setPageBorderFill', 'setPageHide', 'insertNewNumber', 'toggleHideHeaderFooter',
  'createHeaderFooter', 'deleteHeaderFooter', 'applyHfTemplate', 'insertFootnote', 'insertEndnote', 'deleteFootnote',
  // 링크·책갈피·필드·양식·스타일·번호·차트
  'insertHyperlinkEx', 'updateHyperlinkEx', 'removeHyperlinkEx', 'replaceHyperlinkTextEx', 'addBookmark', 'deleteBookmark', 'renameBookmark',
  'insertClickHereField', 'updateClickHereProps', 'removeFieldAt', 'renameField', 'setFieldValue', 'setFieldValueByName', 'setFormValue',
  'applyStyle', 'createStyle', 'updateStyle', 'deleteStyle', 'ensureDefaultNumbering', 'ensureDefaultBullet', 'createNumbering', 'setNumberingRestart', 'setChartData', 'setChartDataByIndex',
  'groupShapes', 'ungroupShape', 'insertEquation', 'setEquationProperties', 'deleteEquationControl', 'pasteControl', 'attachCaptionAt', 'detachCaptionAt',
]);
/** 문서를 바꾸지 않는 조회 API. */
export const QRY = new Set([
  'getHyperlinkContext', 'getBookmarks', 'getFieldList', 'getFieldValue', 'getClickHereProps', 'getFormObjectAt', 'getFormValue', 'getStyleList', 'getStyleAt', 'getStyleDetail',
  'getNumberingList', 'getBulletList', 'listCharts', 'getChartData', 'getChartDataByIndex', 'getLineInfo', 'getHyperlinkContext',
  'getPageDef', 'getSectionDef', 'getColumnDef', 'getPageBorderFill', 'getPageHide', 'getPageInfo', 'getHeaderFooter', 'getHeaderFooterParaInfo', 'getHeaderFooterList', 'getFootnoteInfo',
  'copyControl', 'clipboardHasControl', 'getPictureProperties', 'getShapeProperties', 'getEquationProperties', 'getShapeBBox', 'getPageControlLayout', 'getObjects',
  'getTableDimensions', 'getCellInfo', 'getCellProperties', 'getCellOwnProperties', 'getTableProperties', 'getTableBBox', 'getTableCellBboxes', 'getControls',
]);

const NOOP_MSG = 'no-op';

/**
 * @param {object} c  hwp-edit.js가 만든 문맥: {doc, st, J, mutate, viewInfo, rectOf, inCell, pj, cellPara, paraNo, paraLen, withCellPara}
 * @param {object} m  요청
 */
export function ext(c, m) {
  const { doc, J, mutate, viewInfo, st } = c;
  switch (m.op) {
    case 'api': {
      if (!MUT.has(m.fn) || typeof doc[m.fn] !== 'function') throw { code: 'unknown', message: `api not allowed: ${m.fn}` };
      let out;
      mutate(() => { const r = doc[m.fn](...(m.args ?? [])); try { out = typeof r === 'string' ? J(r) : r; } catch { out = r; } }, false);
      return { result: out, ...viewInfo(doc, st) };
    }
    case 'q': {
      if (!QRY.has(m.fn) || typeof doc[m.fn] !== 'function') throw { code: 'unknown', message: `query not allowed: ${m.fn}` };
      const r = doc[m.fn](...(m.args ?? []));
      let out; try { out = typeof r === 'string' ? J(r) : r; } catch { out = r; }
      return { result: out };
    }
    case 'objfind': return { obj: findObject(doc, J, m.page, m.s, m.p, m.ctrl) };
    case 'objprops': return { props: objProps(doc, J, m.obj) };
    case 'find': return find(c, m);
    case 'repl': return repl(c, m);
    case 'replall': return replAll(c, m);
    case 'hlinsert': return hlInsert(c, m);
    case 'copysel': return copySel(c, m);
    case 'pasterich': return pasteRich(c, m);
    case 'hfget': return hfGet(c, m);
    case 'hfset': return hfSet(c, m);
    case 'fnat': return { fn: fnAt(c, m.pos) };
    case 'fnset': return fnSet(c, m);
    case 'tableAt': return { table: tableAt(c, m.pos) };
    case 'cellrange': return cellRange(c, m.a, m.b);
    case 'cellfmt': return cellFmt(c, m);
    case 'cellclear': return cellClear(c, m);
    default: throw { code: 'unknown', message: `unknown edit op ${m.op}` };
  }
}

// ── 표 위치·범위 ──
/** 위치가 최상위 표 칸 안이면 그 표와 칸 정보. 아니면 null. */
export function tableAt(c, pos) {
  const { doc, J } = c;
  if (!pos || !pos.path || pos.path.length !== 1) return null;
  const { controlIndex: ctrl, cellIndex: cell } = pos.path[0];
  try {
    const dims = J(doc.getTableDimensions(pos.s, pos.p, ctrl));
    const info = J(doc.getCellInfo(pos.s, pos.p, ctrl, cell));
    return { s: pos.s, p: pos.p, ctrl, cell, row: info.row, col: info.col, rowSpan: info.rowSpan, colSpan: info.colSpan, rows: dims.rowCount, cols: dims.colCount };
  } catch { return null; }
}

/** 두 위치가 같은 최상위 표의 서로 다른 칸이면, 그 사이의 칸 블록(병합된 칸을 포함하도록 넓힌 사각형)과 칸 목록·화면 사각형. */
export function cellRange(c, a, b) {
  const { doc, J } = c;
  const A = tableAt(c, a), B = tableAt(c, b);
  if (!A || !B || A.s !== B.s || A.p !== B.p || A.ctrl !== B.ctrl) return { range: null };
  let r1 = Math.min(A.row, B.row), c1 = Math.min(A.col, B.col);
  let r2 = Math.max(A.row + A.rowSpan - 1, B.row + B.rowSpan - 1), c2 = Math.max(A.col + A.colSpan - 1, B.col + B.colSpan - 1);
  const boxes = J(doc.getTableCellBboxes(A.s, A.p, A.ctrl));
  // 병합된 칸이 블록을 걸치면 그 칸이 다 들어오도록 넓힌다
  for (let guard = 0; guard < 50; guard++) {
    let grew = false;
    for (const x of boxes) {
      const xr2 = x.row + x.rowSpan - 1, xc2 = x.col + x.colSpan - 1;
      const overlap = x.row <= r2 && xr2 >= r1 && x.col <= c2 && xc2 >= c1;
      if (overlap && (x.row < r1 || xr2 > r2 || x.col < c1 || xc2 > c2)) {
        r1 = Math.min(r1, x.row); r2 = Math.max(r2, xr2); c1 = Math.min(c1, x.col); c2 = Math.max(c2, xc2); grew = true;
      }
    }
    if (!grew) break;
  }
  const cells = boxes.filter((x) => x.row >= r1 && x.row + x.rowSpan - 1 <= r2 && x.col >= c1 && x.col + x.colSpan - 1 <= c2);
  return {
    range: { s: A.s, p: A.p, ctrl: A.ctrl, r1, c1, r2, c2, rows: A.rows, cols: A.cols },
    cells: cells.map((x) => x.cellIdx),
    rects: cells.map((x) => ({ page: x.pageIndex, x: x.x, y: x.y, w: x.w, h: x.h })),
  };
}

/** 칸 블록의 모든 칸 안 문단 전체에 글자·문단 서식을 적용한다. */
function cellFmt(c, m) {
  const { doc, mutate, viewInfo, st } = c;
  const cr = cellRange(c, m.a, m.b);
  if (!cr.range) return { skipped: true, ...viewInfo(doc, st) };
  const { s, p, ctrl } = cr.range;
  mutate(() => {
    const json = m.kind === 'para' ? JSON.stringify(m.props) : c.charJson(doc, m.props);
    for (const cell of cr.cells) {
      const n = doc.getCellParagraphCount(s, p, ctrl, cell);
      for (let k = 0; k < n; k++) {
        if (m.kind === 'para') doc.applyParaFormatInCell(s, p, ctrl, cell, k, json);
        else {
          const l = doc.getCellParagraphLength(s, p, ctrl, cell, k);
          if (l > 0) doc.applyCharFormatInCell(s, p, ctrl, cell, k, 0, l, json);
        }
      }
    }
  }, false);
  return { ...viewInfo(doc, st) };
}

/** 칸 블록의 글을 모두 지운다(칸 구조는 그대로). */
function cellClear(c, m) {
  const { doc, mutate, viewInfo, st } = c;
  const cr = cellRange(c, m.a, m.b);
  if (!cr.range) return { skipped: true, ...viewInfo(doc, st) };
  const { s, p, ctrl } = cr.range;
  mutate(() => {
    for (const cell of cr.cells) {
      const n = doc.getCellParagraphCount(s, p, ctrl, cell);
      const last = doc.getCellParagraphLength(s, p, ctrl, cell, n - 1);
      if (n > 1 || last > 0) {
        const path = JSON.stringify([{ controlIndex: ctrl, cellIndex: cell, cellParaIndex: 0 }]);
        doc.deleteRangeInCellByPath(s, p, path, 0, 0, n - 1, last);
      }
    }
  }, false);
  return { cleared: cr.cells.length, ...viewInfo(doc, st) };
}

export { NOOP_MSG };

// ── 개체(그림·도형·수식) ──
const OBJ_TYPES = new Set(['image', 'shape', 'line', 'group', 'equation', 'ole', 'chart', 'textbox', 'form']);
const toObj = (c, page) => ({ type: c.type, s: c.secIdx, p: c.paraIdx, ctrl: c.controlIdx, page, x: c.x, y: c.y, w: c.w, h: c.h, wrap: c.wrap ?? null, plane: c.plane, z: c.zOrder });
/** 쪽 좌표 (x, y)에 놓인 개체(표 제외, 칸 안 개체 제외). 겹치면 앞(zOrder 큰 것). 선은 얇아서 3px 여유를 준다. */
export function pickObject(doc, page, x, y) {
  let list;
  try { list = JSON.parse(doc.getPageControlLayout(page)).controls; } catch { return null; }
  let best = null;
  for (const c of list) {
    if (!OBJ_TYPES.has(c.type) || c.cellIdx !== undefined) continue;
    const pad = c.type === 'line' ? 3 : 0;
    if (x >= c.x - pad && x <= c.x + c.w + pad && y >= c.y - pad && y <= c.y + c.h + pad) {
      if (!best || (c.plane ?? 0) > (best.plane ?? 0) || ((c.plane ?? 0) === (best.plane ?? 0) && (c.zOrder ?? 0) >= (best.zOrder ?? 0))) best = c;
    }
  }
  return best ? toObj(best, page) : null;
}
/** 개체의 최신 위치·크기(편집 뒤 틀을 다시 그릴 때). 쪽을 모르면 처음부터 찾는다. */
export function findObject(doc, J, page, s, p, ctrl) {
  const n = doc.pageCount();
  const order = page != null ? [page, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== page)] : Array.from({ length: n }, (_, i) => i);
  for (const pg of order) {
    let list; try { list = J(doc.getPageControlLayout(pg)).controls; } catch { continue; }
    const c = list.find((x) => x.secIdx === s && x.paraIdx === p && x.controlIdx === ctrl && x.cellIdx === undefined && OBJ_TYPES.has(x.type));
    if (c) return toObj(c, pg);
  }
  return null;
}
function objProps(doc, J, o) {
  try {
    if (o.type === 'image') return { kind: 'picture', ...J(doc.getPictureProperties(o.s, o.p, o.ctrl)) };
    if (o.type === 'equation') return { kind: 'equation', ...J(doc.getEquationProperties(o.s, o.p, o.ctrl, -1, -1)) };
    return { kind: 'shape', ...J(doc.getShapeProperties(o.s, o.p, o.ctrl)) };
  } catch { return null; }
}

// ── 머리글·바닥글 ──
// 필드 표지: 0x15 현재 쪽 번호, 0x16 전체 쪽 수, 0x17 파일 이름 — 편집창에서는 {쪽} {전체쪽} {파일이름}으로 보인다.
const MARK = [['\u0015', '{쪽}', 1], ['\u0016', '{전체쪽}', 2], ['\u0017', '{파일이름}', 3]];
const toTokens = (t) => MARK.reduce((a, [m, tok]) => a.split(m).join(tok), t);
/** 머리글·바닥글의 현재 내용: {exists, lines:[text…]}. 쪽 번호 등 표지는 {쪽}으로 바꿔 돌려준다. */
function hfGet(c, m) {
  const { doc, J } = c;
  const g = J(doc.getHeaderFooter(m.s, !!m.header, m.applyTo ?? 0));
  if (!g.exists) return { exists: false, lines: [] };
  const first = J(doc.getHeaderFooterParaInfo(m.s, !!m.header, m.applyTo ?? 0, 0));
  const lines = [toTokens(first.text ?? '')];
  for (let i = 1; i < (first.paraCount ?? 1); i++) lines.push(toTokens(J(doc.getHeaderFooterParaInfo(m.s, !!m.header, m.applyTo ?? 0, i)).text ?? ''));
  return { exists: true, lines };
}
/** 머리글·바닥글을 주어진 줄들로 새로 만든다(한 번의 되돌리기). lines가 비면 지운다. alignment가 있으면 모든 문단에 적용. */
function hfSet(c, m) {
  const { doc, J, mutate, viewInfo, st } = c;
  const at = m.applyTo ?? 0, hd = !!m.header;
  mutate(() => {
    const had = J(doc.getHeaderFooter(m.s, hd, at)).exists;
    if (had) doc.deleteHeaderFooter(m.s, hd, at);
    const lines = (m.lines ?? []).map((x) => String(x));
    if (!lines.length || lines.every((x) => x === '')) return;
    doc.createHeaderFooter(m.s, hd, at);
    lines.forEach((line, i) => {
      if (i > 0) doc.splitParagraphInHeaderFooter(m.s, hd, at, i - 1, [...J(doc.getHeaderFooterParaInfo(m.s, hd, at, i - 1)).text ?? ''].length);
      // 표지({쪽} 등)를 자리마다 필드로 넣는다
      let off = 0;
      for (const part of line.split(/(\{쪽\}|\{전체쪽\}|\{파일이름\})/)) {
        if (!part) continue;
        const f = MARK.find(([, tok]) => tok === part);
        if (f) { doc.insertFieldInHf(m.s, hd, at, i, off, f[2]); off += 1; }
        else { doc.insertTextInHeaderFooter(m.s, hd, at, i, off, part); off += [...part].length; }
      }
      if (m.alignment) doc.applyParaFormatInHf(m.s, hd, at, i, JSON.stringify({ alignment: m.alignment }));
    });
  }, false);
  return { ...viewInfo(doc, st) };
}

// ── 각주 ──
/** 캐럿 문단에서 캐럿 앞(없으면 가장 가까운) 각주/미주: {ctrl, number, lines:[…]} */
function fnAt(c, pos) {
  const { doc, J } = c;
  if (!pos || pos.path) return null;
  let k = 0, positions = [];
  try { positions = J(doc.getControlTextPositions(pos.s, pos.p)); k = positions.length; } catch { return null; }
  let best = null;
  for (let i = 0; i < k; i++) {
    let info; try { info = J(doc.getFootnoteInfo(pos.s, pos.p, i)); } catch { continue; }
    if (!info.ok) continue;
    const d = Math.abs((positions[i] ?? 0) - pos.o);
    if (!best || d < best.d) best = { ctrl: i, number: info.number, lines: info.texts ?? [], d };
  }
  return best ? { ctrl: best.ctrl, number: best.number, lines: best.lines } : null;
}
/** 각주 본문을 주어진 줄들로 바꾼다(기존 글은 지운다). */
function fnSet(c, m) {
  const { doc, J, mutate, viewInfo, st } = c;
  mutate(() => {
    const info = J(doc.getFootnoteInfo(m.s, m.p, m.ctrl));
    const n = info.paraCount ?? 1;
    // 끝 문단부터 합쳐 한 문단으로 만든 뒤 글을 지운다
    for (let i = n - 1; i >= 1; i--) doc.mergeParagraphInFootnote(m.s, m.p, m.ctrl, i);
    const len = [...(J(doc.getFootnoteInfo(m.s, m.p, m.ctrl)).texts?.[0] ?? '')].length;
    if (len > 0) doc.deleteTextInFootnote(m.s, m.p, m.ctrl, 0, 0, len);
    (m.lines ?? []).forEach((line, i) => {
      if (i > 0) doc.splitParagraphInFootnote(m.s, m.p, m.ctrl, i - 1, [...(J(doc.getFootnoteInfo(m.s, m.p, m.ctrl)).texts?.[i - 1] ?? '')].length);
      if (line) doc.insertTextInFootnote(m.s, m.p, m.ctrl, i, 0, String(line));
    });
  }, false);
  return { ...viewInfo(doc, st) };
}

// ── 찾기·바꾸기 ──
const cellPathOf = (cc) => (cc ? [{ controlIndex: cc.ctrlIdx, cellIndex: cc.cellIdx, cellParaIndex: cc.cellPara }] : null);
const posOf = (r, o) => (r.cellContext ? { s: r.sec, p: r.cellContext.parentPara, o, path: cellPathOf(r.cellContext) } : { s: r.sec, p: r.para, o, path: null });
/** 다음/이전 일치를 찾는다: {found, a, b, wrapped}. from은 찾기를 시작할 위치(다음은 선택 끝, 이전은 선택 시작). */
function find(c, m) {
  const { doc, J } = c;
  if (!m.query) return { found: false };
  const f = m.from ?? { s: 0, p: 0, o: 0 };
  const r = J(doc.searchText(m.query, f.s, f.p, f.o, m.forward !== false, !!m.caseSensitive, true));
  if (!r.found) return { found: false };
  return { found: true, wrapped: !!r.wrapped, a: posOf(r, r.charOffset), b: posOf(r, r.charOffset + r.length), total: r.totalMatchCount };
}
/** 일치 하나를 바꾼다(범위 지우고 그 자리에 넣기, 한 번의 되돌리기). */
function repl(c, m) {
  const { doc, mutate, viewInfo, st, inCell } = c;
  let end;
  mutate(() => {
    const at = c.opDeleteRange(doc, m.a, m.b);
    end = m.text ? c.opInsert(doc, at, m.text) : at;
  }, false);
  return { pos: end, rect: c.rectOf(doc, end), ...viewInfo(doc, st) };
}
/** 모두 바꾸기: 일치하는 곳을 문단 안에서 뒤에서부터 바꿔 앞쪽 위치가 어긋나지 않게 한다. */
function replAll(c, m) {
  const { doc, J, mutate, viewInfo, st } = c;
  if (!m.query) return { count: 0, ...viewInfo(doc, st) };
  const all = J(doc.searchAllText(m.query, !!m.caseSensitive, true));
  let count = 0;
  const key = (r) => `${r.sec}|${r.cellContext ? `${r.cellContext.parentPara}/${r.cellContext.ctrlIdx}/${r.cellContext.cellIdx}/${r.cellContext.cellPara}` : r.para}`;
  const list = [...all].sort((x, y) => (key(x) === key(y) ? y.charOffset - x.charOffset : 0));   // 같은 문단 안에서만 뒤에서 앞으로(문단 순서는 그대로)
  if (!list.length) return { count: 0, ...viewInfo(doc, st) };
  mutate(() => {
    // 일치마다 문서 전체를 다시 쪽 나누면 수천 곳에서 몇 분이 걸린다: 배치 모드로 쪽 나누기를 끝에 한 번만 한다
    doc.beginBatch();
    try {
      for (const r of list) {
        const a = posOf(r, r.charOffset), b = posOf(r, r.charOffset + r.length);
        const at = c.opDeleteRange(doc, a, b);
        if (m.text) c.opInsert(doc, at, m.text);
        count++;
      }
    } finally { doc.endBatch(); }
  }, false);
  return { count, ...viewInfo(doc, st) };
}

// ── 하이퍼링크 ──
const hlTarget = (pos) => ({ section: pos.s, para: pos.p, cellPath: (pos.path ?? []).map((x) => [x.controlIndex, x.cellIndex, x.cellParaIndex]) });
/** 선택 범위(또는 새로 넣은 글)에 하이퍼링크를 붙인다. 선택이 없으면 text를 캐럿에 넣고 그 글에 붙인다. */
function hlInsert(c, m) {
  const { doc, mutate, viewInfo, st } = c;
  let end;
  mutate(() => {
    let a = m.a, b = m.b;
    if (m.text) { end = c.opInsert(doc, m.a, m.text); b = end; }
    const target = hlTarget(a);
    const lo = a.o, hi = b.o;
    doc.insertHyperlinkEx(JSON.stringify({ target, start: lo, end: hi, uri: m.uri }));
  }, false);
  return { pos: end ?? m.b, rect: c.rectOf(doc, end ?? m.b), ...viewInfo(doc, st) };
}

// ── 내부 클립보드(서식·개체까지 문서 안에서 붙이기) ──
/** 선택을 엔진 클립보드에 복사하고 글·HTML을 돌려준다(시스템 클립보드에도 넣으려고). 표 칸을 가로지르는 선택은 글만. */
function copySel(c, m) {
  const { doc, J, inCell, pj, cellPara } = c;
  const [a, b] = c.ordered(m.a, m.b);
  if (!c.sameContainer(a, b)) return { text: '', html: '' };
  let text = '', html = '';
  try {
    if (inCell(a)) {
      const path = pj(a);
      text = J(doc.copySelectionInCellByPath(a.s, a.p, path, cellPara(a), a.o, cellPara(b), b.o)).text ?? '';
      html = doc.exportSelectionInCellHtmlByPath(a.s, a.p, path, cellPara(a), a.o, cellPara(b), b.o);
    } else {
      text = J(doc.copySelection(a.s, a.p, a.o, b.p, b.o)).text ?? '';
      html = doc.exportSelectionHtml(a.s, a.p, a.o, b.p, b.o);
    }
  } catch { /* 글만 복사 */ }
  return { text, html };
}
/** 붙여넣기: 엔진 클립보드의 글과 같으면 서식째, 아니면 HTML(있으면)·글로. */
function pasteRich(c, m) {
  const { doc, mutate, viewInfo, st, inCell, pj, cellPara } = c;
  let r = null;
  mutate(() => {
    const pos = m.pos;
    const internal = doc.hasInternalClipboard() && doc.getClipboardText() === m.text;
    if (internal) {
      const x = inCell(pos) ? J2(doc.pasteInternalInCellByPath(pos.s, pos.p, pj(pos), cellPara(pos), pos.o)) : J2(doc.pasteInternal(pos.s, pos.p, pos.o));
      r = inCell(pos) ? { ...c.withCellPara(pos, x.cellParaIdx ?? cellPara(pos)), o: x.charOffset ?? pos.o } : { ...pos, p: x.paraIdx ?? pos.p, o: x.charOffset ?? pos.o };
    } else if (m.html && !inCell(pos)) {
      const x = J2(doc.pasteHtml(pos.s, pos.p, pos.o, m.html));
      r = { ...pos, p: x.paraIdx ?? pos.p, o: x.charOffset ?? pos.o };
    } else return c.NOOP;
  }, false);
  function J2(v) { return typeof v === 'string' ? JSON.parse(v) : v; }
  if (!r) return { fallback: true, ...viewInfo(doc, st) };
  return { pos: r, rect: c.rectOf(doc, r), ...viewInfo(doc, st) };
}
