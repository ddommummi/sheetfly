//! 얇은 뷰어 셸: 열기, 쪽 수, 쪽 SVG만 노출한다. rhwp의 `wasm_api` 전체를 다시 export하지 않는다.
//!
//! 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
use rhwp::DocumentCore;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Viewer {
    core: DocumentCore,
}

#[wasm_bindgen]
impl Viewer {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<Viewer, JsValue> {
        DocumentCore::from_bytes(data)
            .map(|core| Viewer { core })
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self) -> u32 {
        self.core.page_count()
    }

    #[wasm_bindgen(js_name = renderPageSvg)]
    pub fn render_page_svg(&self, page: u32) -> Result<String, JsValue> {
        self.core
            .render_page_svg_native(page)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
