// 열기 전 사전 점검: 크기 한도와 "아직 지원하지 않는 형식"을 빨리 알려 준다.
// 실제 형식 판별과 손상 검출은 엔진(rhwp)이 한다. 여기서는 확장자와 앞 바이트로 안내만 한다.
export const MAX_BYTES = 100 * 1024 * 1024;

const UNSUPPORTED_EXT = {
  xlsx: 'XLSX', xls: 'XLS', pptx: 'PPTX', ppt: 'PPT',
  pdf: 'PDF', odt: 'ODT', ods: 'ODS', odp: 'ODP', txt: '텍스트',
};

export function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/** 열기 전 점검. 문제가 없으면 null, 있으면 { code, arg } */
export function precheck(file, head) {
  if (file.size === 0) return { code: 'empty_file' };
  if (file.size > MAX_BYTES) return { code: 'too_large', arg: Math.ceil(file.size / 1048576) };
  const ext = extOf(file.name);
  if (UNSUPPORTED_EXT[ext]) return { code: 'unsupported_format', arg: UNSUPPORTED_EXT[ext] };
  if (head && head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
    return { code: 'unsupported_format', arg: 'PDF' };
  }
  return null;
}

/**
 * 열 엔진 종류: 'hwp' | 'docx' | 'doc' | 'rtf'. 'hwp' 외에는 모두 DOCX 엔진 Worker가 연다.
 * 확장자보다 앞 바이트를 믿는다(.doc로 저장된 RTF·DOCX가 흔하다). OLE(D0 CF 11 E0)는 HWP 5.x도 같은 껍데기라 확장자로 가른다.
 */
export async function kindOf(file) {
  const ext = extOf(file.name);
  let head = new Uint8Array(0);
  try { head = new Uint8Array(await file.slice(0, 16).arrayBuffer()); } catch { /* 판별 실패는 확장자로 */ }
  const at = (s) => [...s].every((c, i) => head[i] === c.charCodeAt(0));
  if (at('{\\rtf')) return 'rtf';
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp';
  if (ext === 'docx') return 'docx';
  const ole = head.length >= 4 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (ole) return ext === 'doc' ? 'doc' : 'hwp';
  if (ext === 'rtf') return 'rtf';
  try {
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 262144)).arrayBuffer());
    const needle = new TextEncoder().encode('word/document.xml');
    outer: for (let i = 0; i + needle.length <= tail.length; i++) {
      for (let k = 0; k < needle.length; k++) if (tail[i + k] !== needle[k]) continue outer;
      return 'docx';
    }
  } catch { /* 판별 실패는 기본 엔진으로 */ }
  return 'hwp';
}
