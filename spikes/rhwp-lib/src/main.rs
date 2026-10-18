//! 스파이크: rhwp를 라이브러리로 직접 호출해 문서를 열고, 쪽 0의 PageLayerTree를 얻어 구조를 센다.
//! 사용: spike-rhwp-lib <파일>
use rhwp::paint::layer_tree::{LayerNode, LayerNodeKind};
use rhwp::DocumentCore;
use std::collections::BTreeMap;
use std::time::Instant;

fn walk(n: &LayerNode, groups: &mut usize, leaves: &mut usize, ops: &mut usize, kinds: &mut BTreeMap<String, usize>) {
    match &n.kind {
        LayerNodeKind::Group { children, .. } => {
            *groups += 1;
            for c in children {
                walk(c, groups, leaves, ops, kinds);
            }
        }
        LayerNodeKind::ClipRect { child, .. } => {
            *groups += 1;
            walk(child, groups, leaves, ops, kinds);
        }
        LayerNodeKind::Leaf { ops: o } => {
            *leaves += 1;
            *ops += o.len();
            for op in o {
                let dbg = format!("{:?}", op);
                let name = dbg.split(|c: char| !c.is_alphanumeric()).next().unwrap_or("?").to_string();
                *kinds.entry(name).or_default() += 1;
            }
        }
    }
}

fn main() {
    let path = std::env::args().nth(1).expect("usage: spike-rhwp-lib <file>");
    let data = std::fs::read(&path).expect("read");
    let t0 = Instant::now();
    let core = DocumentCore::from_bytes(&data).expect("open");
    let t_open = t0.elapsed();
    let pages = core.page_count();
    let t1 = Instant::now();
    let tree = core.build_page_layer_tree(0).expect("layer tree");
    let t_tree = t1.elapsed();
    let (mut g, mut l, mut o) = (0, 0, 0);
    let mut kinds = BTreeMap::new();
    walk(&tree.root, &mut g, &mut l, &mut o, &mut kinds);
    let t2 = Instant::now();
    let svg = core.render_page_svg_native(0).expect("svg");
    let t_svg = t2.elapsed();
    println!("file={path}");
    println!("pages={pages} open={:?} layer_tree(p0)={:?} svg(p0)={:?} svg_bytes={}", t_open, t_tree, t_svg, svg.len());
    println!("page_size={}x{} groups={g} leaves={l} paint_ops={o}", tree.page_width, tree.page_height);
    println!("paint_op_kinds={kinds:?}");
}
