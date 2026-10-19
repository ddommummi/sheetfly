// PPTX 의미 변이: ZIP을 풀어 슬라이드·레이아웃·마스터·테마 XML의 숫자·구조를 망가뜨린 뒤 다시 묶는다(무압축).
// 바이트 변형은 ZIP 압축 데이터만 깨뜨려 XML 해석 이하를 거의 시험하지 못하므로, 직접 해석기(pptx.js)용으로 따로 둔다.
import { openZip } from '../src/docx/zip.js';
import { zip } from './docx-fixtures.mjs';

const EDGE = ['0', '1', '-1', '32767', '65535', '2147483647', '4294967295', '99999999', '-2147483648', '1e15'];
const dec = new TextDecoder();
export async function unpackPptx(buf) {
  const z = openZip(new Uint8Array(buf));
  const files = [];
  for (const name of z.names()) files.push([name, Buffer.from(await z.read(name))]);
  return files;
}
const isXml = (n) => /^ppt\/(slides|slideLayouts|slideMasters|theme)\/[^/]+\.xml$/.test(n) || n === 'ppt/presentation.xml';

export function mutatePptx(files, rand) {
  const out = files.map(([n, b]) => [n, b]);
  const xmls = out.filter(([n]) => isXml(n));
  const k = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < k; i++) {
    const t = xmls[Math.floor(rand() * xmls.length)];
    let s = dec.decode(t[1]);
    const r = rand();
    if (r < 0.55) {                                    // 숫자 속성 극단값
      const nums = [...s.matchAll(/ (x|y|cx|cy|w|h|sz|val|lvl|marL|indent|rot|gridSpan|rowSpan|lIns|tIns|rIns|bIns|fontScale|lnSpcReduction|idx|spc|baseline)="-?\d+"/g)];
      for (let j = 0; j < 1 + Math.floor(rand() * 3) && nums.length; j++) { const m = nums[Math.floor(rand() * nums.length)]; s = s.replace(m[0], m[0].replace(/"-?\d+"/, `"${EDGE[Math.floor(rand() * EDGE.length)]}"`)); }
    } else if (r < 0.7) {                              // 닫는 태그 하나 지움(구조 깨짐)
      const idx = [...s.matchAll(/<\/[a-zA-Z:]+>/g)]; if (idx.length) { const m = idx[Math.floor(rand() * idx.length)]; s = s.slice(0, m.index) + s.slice(m.index + m[0].length); }
    } else if (r < 0.85) {                             // 도형 하나를 여러 번 복제
      const m = s.match(/<p:sp>[\s\S]*?<\/p:sp>/); if (m) s = s.replace(m[0], m[0].repeat(2 + Math.floor(rand() * 30)));
    } else if (r < 0.93) {                             // 그룹을 깊게 중첩
      s = s.replace('<p:spTree>', '<p:spTree>' + '<p:grpSp><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/><a:chOff x="0" y="0"/><a:chExt cx="1" cy="1"/></a:xfrm></p:grpSpPr>'.repeat(5 + Math.floor(rand() * 40)));
    } else {                                           // 뒤를 자름
      s = s.slice(0, Math.floor(s.length * rand()));
    }
    t[1] = Buffer.from(s);
  }
  // 관계 대상이 사라진 경우도 시험: 가끔 미디어 파일 하나를 지운다
  if (rand() < 0.15) { const m = out.findIndex(([n]) => n.startsWith('ppt/media/')); if (m >= 0) out.splice(m, 1); }
  return zip(out);
}
