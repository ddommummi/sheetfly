// 열기 전 사전 점검: 크기 한도와 "아직 지원하지 않는 형식"을 빨리 알려 준다.
// 실제 형식 판별과 손상 검출은 엔진(rhwp)이 한다. 여기서는 확장자와 앞 바이트로 안내만 한다.
export const MAX_BYTES = 100 * 1024 * 1024;

const UNSUPPORTED_EXT = {
  docx: 'DOCX', doc: 'DOC', xlsx: 'XLSX', xls: 'XLS', pptx: 'PPTX', ppt: 'PPT',
  pdf: 'PDF', odt: 'ODT', ods: 'ODS', odp: 'ODP', rtf: 'RTF', txt: '텍스트',
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
