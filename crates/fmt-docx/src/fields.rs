//! 머리글/바닥글의 필드(쪽 번호 등)를 표식으로 바꾼다.
//!
//! office_oxide는 필드를 구조로 다루지 않고 문서에 저장된 결과 글자("1")만 평문으로 준다. 그러면 모든 쪽의
//! 머리글/바닥글에 같은 번호가 찍힌다. 그래서 DOCX를 office_oxide에 넘기기 전에 머리글/바닥글 부분(`word/header*.xml`,
//! `word/footer*.xml`)의 필드 결과 글자를 사적 영역 표식으로 바꿔 다시 묶는다. 조판 쪽이 표식을 보고 쪽마다 값을 넣는다.
//!
//! 표식: `U+E000` + 종류 + (`:` + 서식) + `U+E001`. 종류는 `P`(PAGE) `N`(NUMPAGES) `S`(SECTIONPAGES).
//! 서식은 필드의 `\* roman|ROMAN|alphabetic|ALPHABETIC|arabic` 스위치에서 온다.
//! 바꾸지 못하거나 이상하면 원본 바이트를 그대로 돌려준다(읽기가 막히는 일이 없게).
use quick_xml::events::{BytesText, Event};
use quick_xml::{Reader, Writer};
use std::io::{Cursor, Read};
use zip::ZipArchive;

const MAX_PART: u64 = 4 * 1024 * 1024; // 머리글/바닥글 부분 하나의 상한(압축 해제 후)
const MAX_PARTS: usize = 64;

fn is_hf_part(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("word/") else { return false };
    (rest.starts_with("header") || rest.starts_with("footer")) && rest.ends_with(".xml") && !rest.contains('/')
}

/// 필드 지시문("PAGE \* roman" 등)에서 표식 본문을 만든다. 모르는 필드면 None.
fn marker_for(instr: &str) -> Option<String> {
    let mut it = instr.split_whitespace();
    let kind = match it.next()?.to_ascii_uppercase().as_str() {
        "PAGE" => 'P',
        "NUMPAGES" => 'N',
        "SECTIONPAGES" => 'S',
        _ => return None,
    };
    let mut fmt = "";
    let toks: Vec<&str> = instr.split_whitespace().collect();
    for w in toks.windows(2) {
        if w[0] == "\\*" {
            match w[1] {
                "roman" | "ROMAN" | "alphabetic" | "ALPHABETIC" | "arabic" => fmt = w[1],
                _ => {}
            }
        }
    }
    Some(if fmt.is_empty() { format!("\u{E000}{kind}\u{E001}") } else { format!("\u{E000}{kind}:{fmt}\u{E001}") })
}

fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

fn attr(e: &quick_xml::events::BytesStart, key: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| local(a.key.as_ref()) == key)
        .and_then(|a| quick_xml::escape::unescape(&a.value).ok().map(|v| v.into_owned()))
}

/// XML 한 부분의 필드 결과 글자를 표식으로 바꾼다. 바뀐 것이 없으면 None.
fn rewrite_part(xml: &[u8]) -> Option<Vec<u8>> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().check_end_names = false;
    let mut writer = Writer::new(Vec::with_capacity(xml.len() + 64));
    let mut buf = Vec::new();
    let mut changed = false;

    // fldSimple: 안의 w:t가 결과. 복합 필드: begin → instrText → separate → 결과 w:t → end.
    let mut simple: Option<String> = None;            // fldSimple의 표식
    struct Cx { instr: String, marker: Option<String>, in_result: bool, wrote: bool }
    let mut stack: Vec<Cx> = Vec::new();
    let mut in_instr = false;
    let mut in_t = false;

    loop {
        let ev = match reader.read_event_into(&mut buf) {
            Ok(e) => e,
            Err(_) => return None,
        };
        let is_empty = matches!(ev, Event::Empty(_)); // 자기 닫힘 태그는 짝이 되는 End가 오지 않으므로 상태를 켜 두지 않는다
        match &ev {
            Event::Eof => break,
            // fldChar는 자기 닫힘(<w:fldChar .../>)과 여는/닫는 태그 쌍(LibreOffice) 두 형태로 저장된다. 속성은 여는 쪽에서 읽는다.
            Event::Start(e) | Event::Empty(e) => {
                match local(e.name().as_ref()) {
                    "fldSimple" if !is_empty => simple = attr(e, "instr").and_then(|i| marker_for(&i)),
                    "instrText" if !is_empty => in_instr = true,
                    "t" if !is_empty => in_t = true,
                    "fldChar" => match attr(e, "fldCharType").as_deref() {
                        Some("begin") => stack.push(Cx { instr: String::new(), marker: None, in_result: false, wrote: false }),
                        Some("separate") => { if let Some(c) = stack.last_mut() { c.marker = marker_for(&c.instr); c.in_result = true; } }
                        Some("end") => { stack.pop(); }
                        _ => {}
                    },
                    _ => {}
                }
            }
            Event::End(e) => match local(e.name().as_ref()) {
                "fldSimple" => simple = None,
                "instrText" => in_instr = false,
                "t" => in_t = false,
                _ => {}
            },
            Event::Text(t) => {
                if in_instr {
                    if let Some(c) = stack.last_mut() { c.instr.push_str(&quick_xml::escape::unescape(t).unwrap_or_default()); }
                } else if in_t {
                    // 결과 글자: 가장 안쪽 복합 필드의 결과 구간이거나 fldSimple 안
                    let marker = match stack.last() {
                        Some(c) if c.in_result => c.marker.clone().map(|m| (m, true)),
                        _ => simple.clone().map(|m| (m, false)),
                    };
                    if let Some((m, complex)) = marker {
                        let first = if complex { stack.last().map(|c| !c.wrote).unwrap_or(true) } else { true };
                        if complex { if let Some(c) = stack.last_mut() { c.wrote = true; } }
                        let text = if first { m } else { String::new() }; // 결과가 여러 조각이면 첫 조각만 표식, 나머지는 비운다
                        if writer.write_event(Event::Text(BytesText::new(&text))).is_err() { return None; }
                        changed = true;
                        buf.clear();
                        continue;
                    }
                }
            }
            _ => {}
        }
        if writer.write_event(ev.borrow()).is_err() { return None; }
        buf.clear();
    }
    changed.then(|| writer.into_inner())
}

// ── 작은 ZIP 재구성기 ──────────────────────────────────────────────────
// `zip`의 쓰기 코드(압축기 포함)를 쓰면 WASM이 약 64KB(brotli) 커져서 예산을 넘는다. 읽기는 office_oxide가 이미 쓰는 `zip`을 그대로 쓰고,
// 바뀐 부분만 무압축으로 저장하는 최소한의 쓰기를 직접 한다. 안 바뀐 항목은 압축된 바이트를 그대로 복사한다. ZIP64·암호화는 지원하지 않는다(None).
struct Entry { name: Vec<u8>, flags: u16, method: u16, time: u16, date: u16, crc: u32, csize: u32, usize_: u32, offset: u32 }

fn u16le(b: &[u8], i: usize) -> Option<u16> { Some(u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?)) }
fn u32le(b: &[u8], i: usize) -> Option<u32> { Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?)) }

fn central_directory(data: &[u8]) -> Option<Vec<Entry>> {
    let start = data.len().saturating_sub(65_557);
    let eocd = (start..data.len().checked_sub(22)? + 1).rev().find(|&i| data[i..].starts_with(&[0x50, 0x4b, 0x05, 0x06]))?;
    let count = u16le(data, eocd + 10)? as usize;
    let mut at = u32le(data, eocd + 16)? as usize;
    if count == 0xFFFF || at == 0xFFFF_FFFF as usize { return None; }
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        if u32le(data, at)? != 0x0201_4b50 { return None; }
        let (nlen, elen, clen) = (u16le(data, at + 28)? as usize, u16le(data, at + 30)? as usize, u16le(data, at + 32)? as usize);
        let e = Entry {
            flags: u16le(data, at + 8)?, method: u16le(data, at + 10)?, time: u16le(data, at + 12)?, date: u16le(data, at + 14)?,
            crc: u32le(data, at + 16)?, csize: u32le(data, at + 20)?, usize_: u32le(data, at + 24)?, offset: u32le(data, at + 42)?,
            name: data.get(at + 46..at + 46 + nlen)?.to_vec(),
        };
        if e.flags & 1 != 0 || e.csize == 0xFFFF_FFFF || e.usize_ == 0xFFFF_FFFF || e.offset == 0xFFFF_FFFF { return None; } // 암호화·ZIP64
        out.push(e);
        at += 46 + nlen + elen + clen;
    }
    Some(out)
}

fn push_local(out: &mut Vec<u8>, e: &Entry, method: u16, crc: u32, csize: u32, usize_: u32) {
    let flags = e.flags & !0x0008; // 데이터 설명자는 쓰지 않는다(크기를 이미 안다)
    out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
    out.extend_from_slice(&20u16.to_le_bytes());
    out.extend_from_slice(&flags.to_le_bytes());
    out.extend_from_slice(&method.to_le_bytes());
    out.extend_from_slice(&e.time.to_le_bytes());
    out.extend_from_slice(&e.date.to_le_bytes());
    out.extend_from_slice(&crc.to_le_bytes());
    out.extend_from_slice(&csize.to_le_bytes());
    out.extend_from_slice(&usize_.to_le_bytes());
    out.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&e.name);
}

/// DOCX 바이트에서 머리글/바닥글의 필드를 표식으로 바꾼 새 바이트를 만든다. 바꿀 것이 없거나 실패하면 None.
pub fn mark_fields(data: &[u8]) -> Option<Vec<u8>> {
    let entries = central_directory(data)?;
    let mut zin = ZipArchive::new(Cursor::new(data)).ok()?;
    let mut rewritten: Vec<Option<Vec<u8>>> = vec![None; entries.len()];
    let mut parts = 0usize;
    for (i, e) in entries.iter().enumerate() {
        let name = String::from_utf8_lossy(&e.name);
        if !is_hf_part(&name) { continue; }
        parts += 1;
        if parts > MAX_PARTS { return None; }
        let mut f = zin.by_name(&name).ok()?;
        if f.size() > MAX_PART { return None; }
        let mut xml = Vec::with_capacity(f.size() as usize);
        (&mut f).take(MAX_PART + 1).read_to_end(&mut xml).ok()?;
        if xml.len() as u64 > MAX_PART { return None; }
        rewritten[i] = rewrite_part(&xml);
    }
    if rewritten.iter().all(Option::is_none) { return None; }

    let mut out: Vec<u8> = Vec::with_capacity(data.len() + 1024);
    let mut offsets = Vec::with_capacity(entries.len());
    let mut finals: Vec<(u16, u32, u32, u32)> = Vec::with_capacity(entries.len()); // method, crc, csize, usize
    for (i, e) in entries.iter().enumerate() {
        offsets.push(out.len() as u32);
        if let Some(new) = &rewritten[i] {
            let crc = crc32fast::hash(new);
            let n = u32::try_from(new.len()).ok()?;
            push_local(&mut out, e, 0, crc, n, n);
            out.extend_from_slice(new);
            finals.push((0, crc, n, n));
        } else {
            let lo = e.offset as usize;
            if u32le(data, lo)? != 0x0403_4b50 { return None; }
            let ds = lo + 30 + u16le(data, lo + 26)? as usize + u16le(data, lo + 28)? as usize;
            let body = data.get(ds..ds.checked_add(e.csize as usize)?)?;
            push_local(&mut out, e, e.method, e.crc, e.csize, e.usize_);
            out.extend_from_slice(body);
            finals.push((e.method, e.crc, e.csize, e.usize_));
        }
    }
    let cd_start = out.len() as u32;
    for (i, e) in entries.iter().enumerate() {
        let (method, crc, csize, usize_) = finals[i];
        out.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&(e.flags & !0x0008).to_le_bytes());
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&e.time.to_le_bytes());
        out.extend_from_slice(&e.date.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&csize.to_le_bytes());
        out.extend_from_slice(&usize_.to_le_bytes());
        out.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
        out.extend_from_slice(&[0u8; 2 + 2 + 2 + 2 + 4]); // extra, comment, disk, 내부 속성, 외부 속성
        out.extend_from_slice(&offsets[i].to_le_bytes());
        out.extend_from_slice(&e.name);
    }
    let cd_size = out.len() as u32 - cd_start;
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_start.to_le_bytes());
    out.extend_from_slice(&[0u8; 2]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const FOOTER: &str = r#"<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>쪽 </w:t></w:r><w:fldSimple w:instr=" PAGE \* roman "><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t> / </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"></w:fldChar></w:r><w:r><w:instrText> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"></w:fldChar></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>"#;

    fn sample(deflate_body: bool) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let method = if deflate_body { zip::CompressionMethod::Deflated } else { zip::CompressionMethod::Stored };
        let o = zip::write::SimpleFileOptions::default().compression_method(method);
        w.start_file("word/document.xml", o).unwrap();
        w.write_all("<w:document>본문 ".repeat(200).as_bytes()).unwrap();
        w.start_file("word/footer1.xml", o).unwrap();
        w.write_all(FOOTER.as_bytes()).unwrap();
        w.start_file("word/media/image1.png", o).unwrap();
        w.write_all(&[0x89, b'P', b'N', b'G', 1, 2, 3, 4, 5]).unwrap();
        w.finish().unwrap().into_inner()
    }

    fn read_all(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut z = ZipArchive::new(Cursor::new(bytes)).expect("유효한 ZIP이어야 한다");
        (0..z.len()).map(|i| { let mut f = z.by_index(i).unwrap(); let mut v = Vec::new(); f.read_to_end(&mut v).expect("CRC·압축 해제가 맞아야 한다"); (f.name().unwrap().into_owned(), v) }).collect()
    }

    #[test]
    fn rewrites_fields_and_keeps_other_entries_byte_identical() {
        for deflate in [true, false] {
            let orig = sample(deflate);
            let out = mark_fields(&orig).expect("필드가 있으므로 새 바이트가 나와야 한다");
            let (a, b) = (read_all(&orig), read_all(&out));
            assert_eq!(a.len(), b.len());
            for ((na, da), (nb, db)) in a.iter().zip(&b) {
                assert_eq!(na, nb);
                if na == "word/footer1.xml" {
                    let t = String::from_utf8(db.clone()).unwrap();
                    assert!(t.contains("\u{E000}P:ROMAN\u{E001}".replace("ROMAN", "roman").as_str()), "{t}");
                    assert!(t.contains("\u{E000}N\u{E001}"), "{t}");
                    assert!(!t.contains(">9<") && !t.contains(">1<"), "저장돼 있던 값이 남으면 안 된다: {t}");
                } else {
                    assert_eq!(da, db, "{na}는 그대로여야 한다");
                }
            }
        }
    }

    #[test]
    fn returns_none_when_nothing_to_change_or_not_a_zip() {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        w.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(b"<w:document/>").unwrap();
        assert!(mark_fields(&w.finish().unwrap().into_inner()).is_none());
        assert!(mark_fields(b"not a zip at all").is_none());
        assert!(mark_fields(&[]).is_none());
    }

    #[test]
    fn corrupt_or_truncated_input_never_panics() {
        let orig = sample(true);
        for cut in (0..orig.len()).step_by(7) { let _ = mark_fields(&orig[..cut]); }
        let mut x = orig.clone();
        for i in (0..x.len()).step_by(5) { x[i] ^= 0x5a; let _ = mark_fields(&x); x[i] ^= 0x5a; }
    }

    /// DOCX_TEST_DIR의 모든 .docx로 왕복 검증(CI에서는 건너뜀): 결과가 유효한 ZIP이고 머리글/바닥글 밖의 항목은 그대로여야 한다.
    #[test]
    fn roundtrip_real_documents_if_dir_given() {
        let Ok(dir) = std::env::var("DOCX_TEST_DIR") else { return };
        let (mut n, mut changed) = (0, 0);
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            if e.path().extension().and_then(|x| x.to_str()) != Some("docx") { continue; }
            let orig = std::fs::read(e.path()).unwrap();
            n += 1;
            if let Some(out) = mark_fields(&orig) {
                changed += 1;
                let (a, b) = (read_all(&orig), read_all(&out));
                assert_eq!(a.len(), b.len(), "{:?}", e.path());
                for ((na, da), (_, db)) in a.iter().zip(&b) { if !is_hf_part(na) { assert_eq!(da, db, "{:?} {na}", e.path()); } }
            }
        }
        eprintln!("실제 문서 {n}개 중 {changed}개에서 필드를 바꿨고 모두 유효한 ZIP");
    }
}
