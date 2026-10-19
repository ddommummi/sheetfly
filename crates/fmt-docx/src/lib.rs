//! Sheetfly DOCX 읽기 어댑터.
//!
//! office_oxide의 IR은 제목(Heading)의 스타일 서식(크기·굵기·색)을 일부러 빼 둔다(Markdown 변환용 설계).
//! 쪽 조판에는 그 서식이 필요하므로, 같은 문서에서 제목 스타일의 실효 서식을 꺼내 IR과 함께 낸다.
//! office_oxide는 수정하지 않고 공개 API(`Document::as_docx`, `StyleSheet::effective_run_properties`)만 쓴다.
//!
//! 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
use office_oxide::{Document, DocumentFormat};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

/// 제목 수준별로 스타일이 정한 글자 서식. 값이 없으면 문서 기본값을 따른다.
#[derive(Serialize, Default)]
pub struct HeadingRun {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size_half_pt: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<[u8; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub char_spacing_twips: Option<i32>,
}

#[derive(Serialize)]
struct Out<'a> {
    ir: &'a office_oxide::ir::DocumentIR,
    /// 키: 제목 수준("1".."9")
    heading_runs: BTreeMap<String, HeadingRun>,
}

fn heading_runs(doc: &Document) -> BTreeMap<String, HeadingRun> {
    let mut out = BTreeMap::new();
    let Some(docx) = doc.as_docx() else { return out };
    let Some(styles) = docx.styles.as_ref() else { return out };
    for level in 1..=9u32 {
        // 내장 제목 스타일 규약: 스타일 ID "Heading1", 이름 "heading 1"
        let id = styles
            .styles
            .values()
            .find(|s| {
                s.style_id == format!("Heading{level}")
                    || s.name.as_deref().map(|n| n.eq_ignore_ascii_case(&format!("heading {level}"))).unwrap_or(false)
            })
            .map(|s| s.style_id.clone());
        let Some(id) = id else { continue };
        let eff = styles.effective_run_properties(Some(&id), None);
        let color = eff
            .color
            .as_ref()
            .and_then(|c| c.resolve_opt(docx.theme.as_ref()))
            .map(|c| c.0);
        out.insert(
            level.to_string(),
            HeadingRun {
                font_size_half_pt: eff.font_size.map(|h| h.0),
                bold: eff.bold,
                italic: eff.italic,
                color,
                font_name: eff.font_name.clone(),
                char_spacing_twips: eff.char_spacing,
            },
        );
    }
    out
}

/// 열린 문서. JS에서는 `new SheetflyDoc(bytes, "docx").toJson()`으로 쓴다.
#[wasm_bindgen]
pub struct SheetflyDoc {
    inner: Document,
}

#[wasm_bindgen]
impl SheetflyDoc {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8], format: &str) -> Result<SheetflyDoc, JsValue> {
        let fmt = match format.to_ascii_lowercase().as_str() {
            "docx" => DocumentFormat::Docx,
            "xlsx" => DocumentFormat::Xlsx,
            "pptx" => DocumentFormat::Pptx,
            other => return Err(JsValue::from_str(&format!("지원하지 않는 형식: {other}"))),
        };
        Document::from_reader(Cursor::new(data.to_vec()), fmt)
            .map(|inner| SheetflyDoc { inner })
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// `{ ir, heading_runs }` JSON 문자열.
    #[wasm_bindgen(js_name = toJson)]
    pub fn to_json(&self) -> Result<String, JsValue> {
        let ir = self.inner.to_ir();
        let out = Out { ir: &ir, heading_runs: heading_runs(&self.inner) };
        serde_json::to_string(&out).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
