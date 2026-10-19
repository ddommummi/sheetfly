use docx_edit::{seed_from_docx, EngineSession};
use serde_json::{json, Value};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).unwrap();
    let font = std::fs::read(&args[2]).unwrap();
    let t0 = Instant::now();
    docx_layout::clear_measure_fonts();
    let font_id = docx_layout::register_measure_font(&font).unwrap();
    let engine = EngineSession::new(1);
    seed_from_docx(engine.doc(), &bytes).unwrap();
    let t_seed = t0.elapsed();
    let package = docx_parse::parse_docx_s9_wire(&bytes, Default::default()).unwrap().document.package;
    let mut sections: Vec<Value> = package.document.sections.clone().unwrap_or_default().into_iter()
        .map(|s| json!({"sectionId": s.id, "properties": s.properties})).collect();
    let last = sections.last().map(|s| s["properties"].clone()).unwrap_or_else(|| json!(package.document.final_section_properties));
    sections.push(json!({"properties": last}));
    let mut contents = Vec::new();
    for (notes, kind) in [(&package.footnotes, "footnote"), (&package.endnotes, "endnote")] {
        for note in notes.iter().flatten() {
            if note.note_type.is_empty() || note.note_type == "normal" {
                contents.push(json!({"id": note.id as i64, "noteKind": kind, "height": 0}));
            }
        }
    }
    let mut request = json!({"bodyStory":"body","renderEnv":{},"options":{"pageGap":24},
        "regions":{"sections":sections,"settings":package.settings},"notes":{"contents":contents}});
    let reqs: Vec<Value> = serde_json::from_str(&engine.layout_font_requirements_json(&request.to_string()).unwrap()).unwrap();
    let chains: serde_json::Map<String, Value> = reqs.iter().map(|r| (r["key"].as_str().unwrap().to_owned(), json!([font_id]))).collect();
    request["measurement"] = json!({"fontChains":chains,"defaults":{"fontSize":11,"fontFamily":"Calibri"},
        "compat":{"noLeading":false,"doNotExpandShiftReturn":false},"authoritativeShaping":true});
    let request = request.to_string();
    let t1 = Instant::now();
    let out: Value = serde_json::from_str(&engine.layout_document_with_regions_retained_json(&request).unwrap()).unwrap();
    let t_layout = t1.elapsed();
    let req: Value = serde_json::from_str(&request).unwrap();
    let extras = json!({"headersFooters": out["headersFooters"], "fontChains": req["measurement"]["fontChains"]});
    let t2 = Instant::now();
    engine.build_display_list_frame(&extras.to_string(), 0).unwrap();
    let t_display = t2.elapsed();
    let (pages, prims) = engine.with_display_list(|l| (l.pages.len(), l.pages.iter().map(|p| p.primitives.len()).sum::<usize>())).unwrap();
    println!("font_requirements={} seed={:?} layout={:?} display={:?} pages={} primitives={}", reqs.len(), t_seed, t_layout, t_display, pages, prims);
    if let Some(p) = args.get(3) {
        let json = engine.with_display_list(|l| serde_json::to_string(l).unwrap()).unwrap();
        std::fs::write(p, json).unwrap();
    }
}
