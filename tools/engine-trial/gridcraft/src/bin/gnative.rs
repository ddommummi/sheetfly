// GridCraft 재계산 정확도 시험: 파일에 저장된 수식 결과(엑셀 등이 계산해 둔 캐시값)를 기준으로 recalc_all 결과를 비교하고, 저장 왕복본을 outdir에 쓴다.
use gridcraft_core::Value;
use std::time::Instant;
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x == y || (x - y).abs() <= 1e-9 * x.abs().max(y.abs()).max(1.0),
        (Value::Text(x), Value::Text(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Error(x), Value::Error(y)) => format!("{x:?}") == format!("{y:?}"),
        (Value::Empty, Value::Empty) => true,
        (Value::Empty, Value::Text(t)) | (Value::Text(t), Value::Empty) => t.is_empty(),
        (Value::Empty, Value::Number(n)) | (Value::Number(n), Value::Empty) => *n == 0.0,
        _ => false,
    }
}
fn show(v: &Value) -> String { match v { Value::Number(n) => format!("{n}"), Value::Text(t) => format!("\"{}\"", t.chars().take(30).collect::<String>()), Value::Array(_) => "array".into(), o => format!("{o:?}") } }
fn j(s: &str) -> String { s.replace('\\', "\\\\").replace('"', "'").replace('\n', " ").replace('\t', " ") }
fn main() {
    let list = std::env::args().nth(1).unwrap();
    let outdir = std::env::args().nth(2).unwrap();
    for (n, path) in std::fs::read_to_string(list).unwrap().lines().enumerate() {
        let Ok(bytes) = std::fs::read(path) else { continue };
        let esc = j(path);
        let t0 = Instant::now();
        let r = std::panic::catch_unwind(|| gridcraft_xlsx::read_xlsx(&bytes));
        let read_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (mut wb, rep) = match r { Err(_) => { println!("{{\"f\":\"{esc}\",\"read\":\"panic\"}}"); continue }, Ok(Err(e)) => { println!("{{\"f\":\"{esc}\",\"read\":\"err\",\"e\":\"{}\"}}", j(&format!("{e}").chars().take(50).collect::<String>())); continue }, Ok(Ok(x)) => x };
        // 캐시값 저장
        let mut cached: Vec<(usize, u32, u32, Value, String)> = Vec::new();
        let mut cells = 0usize;
        for (si, sh) in wb.sheets.iter().enumerate() { for (cr, c) in sh.cells.iter() { cells += 1; if let Some(f) = &c.formula { cached.push((si, cr.row, cr.col, c.value.clone(), f.text.clone())); } } }
        let t1 = Instant::now();
        let rc = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let mut calc = gridcraft_calc::Calc::new(); calc.recalc_all(&mut wb); }));
        let calc_ms = t1.elapsed().as_secs_f64() * 1000.0;
        if rc.is_err() { println!("{{\"f\":\"{esc}\",\"read\":\"ok\",\"cells\":{cells},\"formulas\":{},\"calc\":\"panic\"}}", cached.len()); continue; }
        let mut bad = 0usize; let mut ex: Vec<String> = Vec::new(); let mut scalar = 0usize;
        for (si, row, col, old, text) in &cached {
            let cr = gridcraft_core::CellRef::new(*row, *col);
            let new = wb.sheets[*si].cells.get(cr).map(|c| c.value.clone()).unwrap_or(Value::Empty);
            if matches!(old, Value::Array(_)) || matches!(new, Value::Array(_)) { continue; }
            scalar += 1;
            if !same(old, &new) { bad += 1; if ex.len() < std::env::var("EXMAX").ok().and_then(|v| v.parse().ok()).unwrap_or(4usize) { ex.push(format!("{}!R{}C{} ={} 캐시 {} 계산 {}", si, row, col, j(&text.chars().take(90).collect::<String>()), show(old), show(&new))); } }
        }
        let w = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| gridcraft_xlsx::write_xlsx(&wb)));
        let (wr, wlen) = match &w { Ok(Ok(b)) => { let _ = std::fs::write(format!("{outdir}/{n}.xlsx"), b); ("ok", b.len()) }, Ok(Err(_)) => ("err", 0), Err(_) => ("panic", 0) };
        println!("{{\"f\":\"{esc}\",\"n\":{n},\"read\":\"ok\",\"readMs\":{read_ms:.1},\"cells\":{cells},\"formulas\":{},\"scalar\":{scalar},\"bad\":{bad},\"calcMs\":{calc_ms:.1},\"write\":\"{wr}\",\"wlen\":{wlen},\"warn\":{},\"ex\":{:?}}}", cached.len(), rep.warnings.len(), ex);
    }
}
