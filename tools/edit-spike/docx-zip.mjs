// DOCX(ZIP) 부분 교체 스파이크: 바꾸지 않은 부품은 압축된 바이트 그대로 복사하고, 바꾼 부품만 새로 압축해 넣는다.
// 브라우저에서는 deflateRaw를 CompressionStream('deflate-raw')로 대체한다(여기서는 Node zlib).
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';

const u16 = (b, o) => b.readUInt16LE(o), u32 = (b, o) => b.readUInt32LE(o);

/** ZIP 중앙 디렉터리를 읽는다. ZIP64·암호·다중 디스크는 지원하지 않는다(DOCX에는 거의 없다). */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP 끝 레코드를 찾지 못했다');
  const count = u16(buf, eocd + 10), cdSize = u32(buf, eocd + 12), cdOff = u32(buf, eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new Error('ZIP64는 지원하지 않는다');
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('중앙 디렉터리가 깨졌다');
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
    const e = {
      flags: u16(buf, p + 8), method: u16(buf, p + 10), crc: u32(buf, p + 16), csize: u32(buf, p + 20), usize: u32(buf, p + 24),
      localOff: u32(buf, p + 42), name: buf.toString('utf8', p + 46, p + 46 + nameLen), cdRaw: Buffer.from(buf.subarray(p, p + 46 + nameLen + extraLen + commentLen)),
    };
    const lh = e.localOff;
    e.localLen = 30 + u16(buf, lh + 26) + u16(buf, lh + 28) + e.csize + ((e.flags & 8) ? 16 : 0);   // 데이터 서술자(bit 3)가 있으면 뒤에 16바이트
    entries.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, cdOff, cdSize };
}
export function readPart(buf, e) {
  const lh = e.localOff, start = lh + 30 + u16(buf, lh + 26) + u16(buf, lh + 28);
  const raw = buf.subarray(start, start + e.csize);
  return e.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
}

/** changes: Map(이름 → 새 바이트). 나머지 부품은 원본 바이트 그대로. */
export function rewriteZip(buf, changes) {
  const { entries } = readZip(buf);
  const out = [];
  const cds = [];
  let off = 0;
  for (const e of entries) {
    let local, cd = Buffer.from(e.cdRaw);
    if (changes.has(e.name)) {
      const data = Buffer.from(changes.get(e.name));
      const comp = deflateRawSync(data);
      const name = Buffer.from(e.name, 'utf8');
      const crc = crc32(data);
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
      h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
      local = Buffer.concat([h, name, comp]);
      cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    } else local = buf.subarray(e.localOff, e.localOff + e.localLen);
    cd.writeUInt32LE(off, 42);
    out.push(local); cds.push(cd); off += local.length;
  }
  const cdBuf = Buffer.concat(cds);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...out, cdBuf, end]);
}
