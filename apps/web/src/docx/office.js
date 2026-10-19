// XLSX·PPTX(와 구형 XLS·PPT) IR → 조판 엔진이 받는 IR. office_oxide는 시트를 "표 하나인 구역", 슬라이드를 "쪽 크기가 슬라이드인 구역"으로 준다.
// 여기서는 그 위에 보는 데 필요한 것만 덧붙인다: 시트는 열이 안 잘리게 쪽 너비를 키우고(조판의 fit_width), 숫자는 오른쪽 맞춤, 옅은 격자선.
// 입력은 신뢰할 수 없으므로 시트 크기에 상한을 둔다.
const MAX_ROWS = 20000;
const MAX_COLS = 256;
const GRID = { style: 'single', size: 2, color: [208, 208, 208] };
const GRID_BORDER = { top: GRID, bottom: GRID, left: GRID, right: GRID, inside_h: GRID, inside_v: GRID };
const SHEET_PAGE = { width_twips: 16838, height_twips: 11906, margin_top_twips: 720, margin_bottom_twips: 720, margin_left_twips: 720, margin_right_twips: 720, header_distance_twips: 360, footer_distance_twips: 360, landscape: true };
const SLIDE_MARGIN = 720;
const TITLE_HALF_PT = 72;   // 슬라이드 제목에 크기가 없으면(마스터에서 물려받는 값을 IR이 주지 않는다) 36pt
const emptyCell = () => ({ content: [{ type: 'paragraph', content: [] }], col_span: 1, row_span: 1 });

const RIGHT_TYPES = new Set(['number', 'date', 'currency', 'percent', 'percentage', 'time']);

function alignCell(cell) {
  const a = RIGHT_TYPES.has(cell.data_type) ? 'right' : cell.data_type === 'boolean' ? 'center' : null;
  const content = (cell.content ?? []).map((p) => {
    if (p.type !== 'paragraph' && p.type !== 'heading') return p;
    return { ...p, alignment: p.alignment ?? a ?? undefined, space_after_twips: 0, space_before_twips: 0 };
  });
  return { ...cell, content };
}

/** 한 시트의 표를 다듬는다: 행마다 열 수를 맞추고, 숫자 맞춤·격자선을 준다. */
function prepareSheetTable(tbl, warn) {
  let rows = (tbl.rows ?? []).slice(0, MAX_ROWS);
  if ((tbl.rows ?? []).length > MAX_ROWS) warn(`행이 ${MAX_ROWS}개를 넘어 이후는 생략했다`);
  // 열 수: 행 병합(row_span)이 아래 행의 칸을 차지하는 것까지 센다
  const occupied = [];
  let ncols = 0;
  rows.forEach((row, r) => {
    occupied[r] = occupied[r] ?? 0;
    let c = occupied[r];
    for (const cell of row.cells ?? []) {
      const cs = Math.max(1, cell.col_span || 1), rs = Math.max(1, cell.row_span || 1);
      c += cs;
      for (let d = 1; d < rs && r + d < rows.length; d++) occupied[r + d] = (occupied[r + d] ?? 0) + cs;
    }
    ncols = Math.max(ncols, c);
  });
  if (ncols > MAX_COLS) { warn(`열이 ${MAX_COLS}개를 넘어 이후는 생략했다`); ncols = MAX_COLS; }
  rows = rows.map((row, r) => {
    const cells = [];
    let c = occupied[r] ?? 0;
    for (const cell of row.cells ?? []) {
      if (c >= ncols) break;
      const cs = Math.max(1, Math.min(cell.col_span || 1, ncols - c));
      cells.push(alignCell({ ...cell, col_span: cs }));
      c += cs;
    }
    while (c < ncols) { cells.push(emptyCell()); c++; }
    return { ...row, cells };
  });
  return {
    ...tbl, rows, column_widths_twips: Array(ncols).fill(1440),
    border: tbl.border ?? GRID_BORDER,
    cell_padding_twips: { left_twips: 60, right_twips: 60, top_twips: 20, bottom_twips: 20 },
  };
}

export function adaptSheets(ir, warn = () => {}) {
  const sections = (ir.sections ?? []).map((sec, i) => {
    const title = sec.title || `시트 ${i + 1}`;
    const elements = (sec.elements ?? []).map((e) => (e.type === 'table' ? prepareSheetTable(e, warn) : e));
    const hasTable = elements.some((e) => e.type === 'table');
    if (!hasTable && !elements.length) warn(`"${title}"는 표시할 내용이 없다(차트 시트이거나 비어 있다)`);
    return {
      ...sec, elements, fit_width: true, break_type: 'next_page', page_setup: SHEET_PAGE,
      header: { content: [{ type: 'paragraph', content: [{ type: 'text', text: title, bold: true, font_size_half_pt: 18, color: [96, 96, 96] }], space_after_twips: 0 }] },
    };
  });
  return { ...ir, sections };
}

/** 슬라이드 안의 표(상자 속 포함)에 격자선을 준다. IR은 표 스타일을 주지 않아 선이 없으면 구조가 안 보인다. */
function slideBlocks(blocks) {
  return (blocks ?? []).map((e) => {
    if (e.type === 'table') return { ...e, border: e.border ?? GRID_BORDER };
    if (e.type === 'text_box') return { ...e, content: slideBlocks(e.content) };
    if (e.type === 'heading') return { ...e, content: (e.content ?? []).map((r) => (r.type === 'text' && r.font_size_half_pt == null ? { ...r, font_size_half_pt: TITLE_HALF_PT } : r)) };
    return e;
  });
}

export function adaptSlides(ir) {
  const sections = (ir.sections ?? []).map((sec) => ({
    ...sec, elements: slideBlocks(sec.elements), break_type: 'next_page',
    page_setup: { ...(sec.page_setup ?? {}), margin_top_twips: SLIDE_MARGIN, margin_bottom_twips: SLIDE_MARGIN, margin_left_twips: SLIDE_MARGIN, margin_right_twips: SLIDE_MARGIN },
  }));
  return { ...ir, sections };
}
