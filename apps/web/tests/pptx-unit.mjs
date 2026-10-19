// PPTX 직접 해석기 단위 시험(브라우저 없이 Node에서). 시험이 만든 sample.pptx를 읽어 위치·상속·그림 배치를 확인한다.
//   node tests/pptx-unit.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePptx } from '../src/docx/pptx.js';
import { layoutDocument, pageToSvg, createFakeMeasurer } from '../src/docx/index.js';
import { openZip } from '../src/docx/zip.js';
import { parseXml } from '../src/docx/xml.js';

const fixture = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const text = (box) => (box.content ?? []).flatMap((p) => (p.content ?? []).map((r) => r.text ?? '')).join('');

test('슬라이드 수·크기·경고 없음', async () => {
  const r = await parsePptx(fixture('sample.pptx'));
  assert.equal(r.ir.sections.length, 4);
  const ps = r.ir.sections[0].page_setup;
  assert.equal(ps.width_twips, Math.round(12191695 / 635));          // 13.333in
  assert.equal(ps.height_twips, Math.round(6858000 / 635));         // 7.5in
  assert.deepEqual(r.warnings, []);
});

test('제목 자리 표시자: 레이아웃에서 위치·세로 정렬을 상속한다 (IR 경로는 이 값을 잃었다)', async () => {
  const r = await parsePptx(fixture('sample.pptx'));
  const [title, sub] = r.ir.sections[0].elements;
  assert.equal(text(title), '제목 슬라이드');
  assert.ok(title.width_emu > 0 && title.height_emu > 0, '상속한 크기');
  assert.ok(title.y_emu > 0 && title.y_emu < 6858000 / 2, `제목은 위쪽 절반: ${title.y_emu}`);
  assert.equal(title.anchor, 'ctr', '마스터 제목의 세로 가운데 정렬 상속');
  assert.equal(title.content[0].alignment, 'center');
  assert.ok(title.content[0].content[0].font_size_half_pt >= 80, `마스터 제목 크기 상속: ${title.content[0].content[0].font_size_half_pt}`);
  assert.ok(sub.y_emu > title.y_emu, '부제목은 제목 아래');
});

test('자리 표시자가 직접 지정한 위치는 레이아웃 기본값보다 우선한다 (그림 아래의 제목)', async () => {
  const r = await parsePptx(fixture('sample.pptx'));
  const els = r.ir.sections[3].elements;
  const title = els.find((e) => text(e) === 'AI 에이전트');
  const pic = els.find((e) => e.picture);
  assert.ok(title && pic);
  assert.ok(title.y_emu >= pic.y_emu + pic.height_emu, `제목(${title.y_emu})은 그림 바닥(${pic.y_emu + pic.height_emu}) 아래`);
  assert.equal(pic.content[0].format, 'png');
});

test('글머리표·표·도형 글자', async () => {
  const r = await parsePptx(fixture('sample.pptx'));
  const body = r.ir.sections[1].elements.find((e) => text(e).includes('첫째 항목'));
  assert.ok(body.content.every((p) => p.marker_text), '본문 목록의 글머리표');
  const tbl = r.ir.sections[2].elements.find((e) => e.content?.[0]?.type === 'table');
  assert.equal(tbl.content[0].rows.length, 3);
  assert.ok(r.ir.sections[2].elements.some((e) => text(e) === '도형 텍스트'));
});

test('손상·악의적 입력은 예외로 끝나고 멈추지 않는다', async () => {
  const good = fixture('sample.pptx');
  await assert.rejects(parsePptx(good.subarray(0, 500)));
  await assert.rejects(parsePptx(new Uint8Array(1000)));
  // 깊이 폭탄·큰 XML은 해석기가 거부한다
  assert.throws(() => parseXml('<a>'.repeat(5000)));
  const z = openZip(good); assert.ok(z.has('ppt/presentation.xml'));
});

test('그림 자르기(srcRect): IR에 crop이 실리고 SVG가 원본의 일부만 상자에 채운다 (욱여넣어 찌그러지던 문제의 회귀 시험)', async () => {
  const r = await parsePptx(fixture('sample.pptx'));
  const pic = r.ir.sections[3].elements.find((e) => e.picture);
  const crop = pic.content[0].crop;
  assert.ok(crop && Math.abs(crop.l - 0.25) < 1e-3 && Math.abs(crop.r - 0.25) < 1e-3 && Math.abs(crop.t - 0.1) < 1e-3 && !crop.b, JSON.stringify(crop));
  const res = layoutDocument(r.ir, createFakeMeasurer(), {});
  const svg = pageToSvg(res.pages[3], createFakeMeasurer());
  assert.match(svg, /<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" viewBox="0\.25 0\.1 0\.5 0\.9" preserveAspectRatio="none"><image /);
  // 자르지 않은 그림(슬라이드 3)은 그대로 <image>
  assert.doesNotMatch(pageToSvg(res.pages[2], createFakeMeasurer()), /viewBox="0\.\d+ /);
});
