//! 구역(`w:sectPr`)마다 줄 격자(`w:docGrid`)를 읽는다.
//!
//! office_oxide의 IR에는 줄 격자가 없다(요소 자체가 스키마에 없다). 줄을 격자 칸에 맞추는 문서(한국어·중국어·일본어 문서에 흔하다)는
//! 줄 높이가 달라지므로 조판이 값을 알아야 한다. 그래서 `word/document.xml`을 office_oxide와 별개로 한 번 더 훑어 구역마다의 값을 꺼낸다.
//! IR을 바꾸거나 DOCX를 다시 쓰지 않는다: 결과는 JSON의 `doc_grid`(구역 순서, 격자가 없는 구역은 null)로만 나간다.
//! 읽지 못하거나 이상하면 빈 결과를 돌려준다(읽기가 막히는 일이 없게).
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;
use std::io::{Cursor, Read};
use zip::ZipArchive;

const MAX_DOC_XML: u64 = 64 * 1024 * 1024; // 압축 해제 뒤 본문 부분의 상한(신뢰할 수 없는 입력)
const MAX_SECTIONS: usize = 10_000;

/// 한 구역의 줄 격자. 값은 모두 `w:docGrid`의 속성 그대로다(단위 twips).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct DocGrid {
    /// `w:type`: "default"(격자 없음) | "lines" | "linesAndChars" | "snapToChars". 없거나 모르는 값이면 "default".
    #[serde(rename = "type")]
    pub kind: String,
    /// `w:linePitch`: 격자 한 칸의 높이.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_pitch: Option<u32>,
    /// `w:charSpace`: 글자 칸 너비를 정하는 값(음수도 있다).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub char_space: Option<i32>,
}

fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

fn grid_of(e: &BytesStart) -> DocGrid {
    let (mut kind, mut line_pitch, mut char_space) = ("default", None, None);
    for a in e.attributes().flatten() {
        let Ok(v) = quick_xml::escape::unescape(&a.value) else { continue };
        match local(a.key.as_ref()) {
            "type" => kind = match v.as_ref() { "lines" => "lines", "linesAndChars" => "linesAndChars", "snapToChars" => "snapToChars", _ => "default" },
            "linePitch" => line_pitch = v.trim().parse::<u32>().ok(),
            "charSpace" => char_space = v.trim().parse::<i32>().ok(),
            _ => {}
        }
    }
    DocGrid { kind: kind.to_owned(), line_pitch, char_space }
}

/// `document.xml` 한 부분에서 구역마다의 줄 격자를 문서 순서로 모은다. 구역이 없거나 XML이 깨졌으면 빈 목록.
/// `w:sectPrChange` 안(바뀌기 전 옛 구역 속성)의 `sectPr`는 구역으로 세지 않는다.
pub fn parse_grids(xml: &[u8]) -> Vec<Option<DocGrid>> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().check_end_names = false;
    let mut buf = Vec::new();
    let mut out: Vec<Option<DocGrid>> = Vec::new();
    let mut change_depth = 0usize;
    let mut in_sect = false;
    let mut cur: Option<DocGrid> = None;
    loop {
        let ev = match reader.read_event_into(&mut buf) {
            Ok(e) => e,
            Err(_) => return Vec::new(), // 깨졌으면 일부만 믿지 않는다(구역 순서가 어긋날 수 있다)
        };
        match &ev {
            Event::Eof => break,
            Event::Start(e) => match local(e.name().as_ref()) {
                "sectPrChange" => change_depth += 1,
                "sectPr" if change_depth == 0 => { in_sect = true; cur = None; }
                "docGrid" if in_sect && change_depth == 0 => cur = Some(grid_of(e)),
                _ => {}
            },
            Event::Empty(e) => match local(e.name().as_ref()) {
                "sectPr" if change_depth == 0 => out.push(None), // 속성이 하나도 없는 구역
                "docGrid" if in_sect && change_depth == 0 => cur = Some(grid_of(e)),
                _ => {}
            },
            Event::End(e) => match local(e.name().as_ref()) {
                "sectPrChange" => change_depth = change_depth.saturating_sub(1),
                "sectPr" if change_depth == 0 && in_sect => { out.push(cur.take()); in_sect = false; }
                _ => {}
            },
            _ => {}
        }
        if out.len() > MAX_SECTIONS { return Vec::new(); }
        buf.clear();
    }
    out
}

/// DOCX 바이트에서 구역마다의 줄 격자를 읽는다. 격자가 든 구역이 하나도 없거나 읽지 못하면 빈 목록.
pub fn read_doc_grids(data: &[u8]) -> Vec<Option<DocGrid>> {
    let Ok(mut zip) = ZipArchive::new(Cursor::new(data)) else { return Vec::new() };
    let Ok(mut f) = zip.by_name("word/document.xml") else { return Vec::new() };
    if f.size() > MAX_DOC_XML { return Vec::new(); }
    let mut xml = Vec::with_capacity(f.size() as usize);
    if (&mut f).take(MAX_DOC_XML + 1).read_to_end(&mut xml).is_err() || xml.len() as u64 > MAX_DOC_XML { return Vec::new(); }
    let grids = parse_grids(&xml);
    if grids.iter().all(Option::is_none) { Vec::new() } else { grids }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;

    fn g(kind: &str, pitch: Option<u32>, space: Option<i32>) -> Option<DocGrid> {
        Some(DocGrid { kind: kind.to_owned(), line_pitch: pitch, char_space: space })
    }

    fn docx(document_xml: &str) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        w.start_file("word/document.xml", o).unwrap();
        w.write_all(document_xml.as_bytes()).unwrap();
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn reads_the_trailing_section_grid() {
        let xml = format!(r#"<w:document {NS}><w:body><w:p/><w:sectPr><w:pgSz w:w="11906"/><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr></w:body></w:document>"#);
        assert_eq!(parse_grids(xml.as_bytes()), vec![g("lines", Some(360), None)]);
    }

    #[test]
    fn reads_every_section_in_document_order_and_keeps_gaps() {
        // 구역 1(문단 안 sectPr): 격자 있음, 구역 2: 격자 없음, 구역 3(본문 끝): 글자까지 맞춤
        let xml = format!(
            r#"<w:document {NS}><w:body>
                 <w:p><w:pPr><w:sectPr><w:docGrid w:type="linesAndChars" w:linePitch="312" w:charSpace="-1024"/></w:sectPr></w:pPr></w:p>
                 <w:p><w:pPr><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr></w:p>
                 <w:sectPr><w:docGrid w:type="snapToChars" w:linePitch="360" w:charSpace="4096"/></w:sectPr>
               </w:body></w:document>"#
        );
        assert_eq!(parse_grids(xml.as_bytes()), vec![g("linesAndChars", Some(312), Some(-1024)), None, g("snapToChars", Some(360), Some(4096))]);
    }

    #[test]
    fn a_self_closing_section_counts_as_a_section_without_grid() {
        let xml = format!(r#"<w:document {NS}><w:body><w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:sectPr><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr></w:body></w:document>"#);
        assert_eq!(parse_grids(xml.as_bytes()), vec![None, g("lines", Some(360), None)]);
    }

    #[test]
    fn ignores_the_old_properties_inside_sect_pr_change() {
        // 바뀌기 전 옛 구역 속성(w:sectPrChange 안의 sectPr)은 구역이 아니고, 그 안의 격자도 현재 값이 아니다.
        let xml = format!(
            r#"<w:document {NS}><w:body><w:sectPr><w:docGrid w:type="lines" w:linePitch="360"/>
                 <w:sectPrChange w:id="1"><w:sectPr><w:docGrid w:type="snapToChars" w:linePitch="999"/></w:sectPr></w:sectPrChange>
               </w:sectPr></w:body></w:document>"#
        );
        assert_eq!(parse_grids(xml.as_bytes()), vec![g("lines", Some(360), None)]);
    }

    #[test]
    fn works_with_other_prefixes_and_strict_namespace() {
        let xml = r#"<ns0:document xmlns:ns0="http://purl.oclc.org/ooxml/wordprocessingml/main"><ns0:body><ns0:sectPr><ns0:docGrid ns0:type="lines" ns0:linePitch="400"/></ns0:sectPr></ns0:body></ns0:document>"#;
        assert_eq!(parse_grids(xml.as_bytes()), vec![g("lines", Some(400), None)]);
    }

    #[test]
    fn missing_or_unknown_type_is_default_and_bad_numbers_are_dropped() {
        let xml = format!(r#"<w:document {NS}><w:body><w:sectPr><w:docGrid w:type="weird" w:linePitch="abc" w:charSpace="99999999999"/></w:sectPr></w:body></w:document>"#);
        assert_eq!(parse_grids(xml.as_bytes()), vec![g("default", None, None)]);
        let xml = format!(r#"<w:document {NS}><w:body><w:sectPr><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>"#);
        assert_eq!(parse_grids(xml.as_bytes()), vec![g("default", Some(360), None)]);
    }

    #[test]
    fn read_doc_grids_is_empty_when_no_section_has_a_grid() {
        let xml = format!(r#"<w:document {NS}><w:body><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:body></w:document>"#);
        assert!(read_doc_grids(&docx(&xml)).is_empty());
        let xml = format!(r#"<w:document {NS}><w:body><w:sectPr><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr></w:body></w:document>"#);
        assert_eq!(read_doc_grids(&docx(&xml)), vec![g("lines", Some(360), None)]);
    }

    #[test]
    fn not_a_zip_or_no_document_part_or_broken_xml_gives_nothing() {
        assert!(read_doc_grids(b"not a zip").is_empty());
        assert!(read_doc_grids(&[]).is_empty());
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        w.start_file("word/other.xml", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(b"<a/>").unwrap();
        assert!(read_doc_grids(&w.finish().unwrap().into_inner()).is_empty());
        // 구역이 하나도 없는 XML·쓰레기 바이트는 빈 목록
        assert!(parse_grids(b"<w:document><w:body><w:p/></w:body></w:document>").is_empty());
        assert!(parse_grids(&[0xff, 0xfe, 0x00, 0x3c, 0x41]).is_empty());
    }

    #[test]
    fn corrupt_or_truncated_input_never_panics() {
        let xml = format!(r#"<w:document {NS}><w:body><w:p><w:pPr><w:sectPr><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr></w:pPr></w:p><w:sectPr><w:docGrid w:type="lines"/></w:sectPr></w:body></w:document>"#);
        let b = xml.as_bytes();
        for cut in 0..b.len() { let _ = parse_grids(&b[..cut]); }
        let z = docx(&xml);
        for cut in (0..z.len()).step_by(5) { let _ = read_doc_grids(&z[..cut]); }
        let mut x = z.clone();
        for i in (0..x.len()).step_by(7) { x[i] ^= 0x5a; let _ = read_doc_grids(&x); x[i] ^= 0x5a; }
    }

    /// DOCX_TEST_DIR의 모든 .docx를 읽어 패닉이 없고 구역 수가 말이 되는지 본다(CI에서는 건너뜀).
    #[test]
    fn real_documents_if_dir_given() {
        let Ok(dir) = std::env::var("DOCX_TEST_DIR") else { return };
        let (mut n, mut with_grid) = (0, 0);
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            if e.path().extension().and_then(|x| x.to_str()) != Some("docx") { continue; }
            n += 1;
            let grids = read_doc_grids(&std::fs::read(e.path()).unwrap());
            if !grids.is_empty() { with_grid += 1; }
        }
        eprintln!("실제 문서 {n}개 중 {with_grid}개에서 줄 격자를 읽었다");
    }
}
