// 읽기 전용 JSZip 호환 shim(실험용): docx-engine 파싱 경로가 쓰는 표면만 구현한다.
//   loadAsync(bytes) / file(name) / file(name, data) [메모리 덮어쓰기] / files / entry.async(type) / entry.date / entry._data.uncompressedSize
// 쓰기(generateAsync)는 지원하지 않는다. 풀기는 DecompressionStream('deflate-raw')만 쓴다.
const td = new TextDecoder('utf-8', { ignoreBOM: true });   // JSZip처럼 앞쪽 BOM(U+FEFF)을 문자열에 남긴다(저장 때 오프셋·바이트를 맞추기 위해)
const te = new TextEncoder();

async function inflateRaw(u8) {
  const out = new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
  return new Uint8Array(await out.arrayBuffer());
}
function toType(u8, type) {
  switch (type) {
    case 'string': case 'text': return td.decode(u8);
    case 'uint8array': return u8;
    case 'arraybuffer': return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    case 'base64': { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
    default: throw new Error('jszip-shim: 지원하지 않는 async 형식 ' + type);
  }
}
function memEntry(name, data, date) {
  const u8 = typeof data === 'string' ? te.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  return { name, dir: false, date: date ?? new Date(), _data: { uncompressedSize: u8.length }, async: async (t) => toType(u8, t) };
}

export default class JSZip {
  constructor() { this.files = {}; }
  static async loadAsync(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Can't find end of central directory : is this a zip file ?");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const zip = new JSZip();
    for (let i = 0; i < count; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupted zip : bad central directory');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (flags & 1) throw new Error('Encrypted zip are not supported');
      const dir = name.endsWith('/');
      zip.files[name] = {
        name, dir, date: new Date(), _data: { uncompressedSize: usize },
        async: async (type) => {
          if (dir) return toType(new Uint8Array(0), type);
          const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
          const raw = u8.subarray(start, start + csize);
          const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : (() => { throw new Error('unsupported compression ' + method); })();
          return toType(data, type);
        },
      };
    }
    return zip;
  }
  file(name, data, opts) {
    if (data === undefined) return this.files[name] ?? null;
    this.files[name] = memEntry(name, data, opts?.date);
    return this;
  }
  async generateAsync() { throw new Error('jszip-shim: 쓰기는 지원하지 않는다(읽기 전용)'); }
}
