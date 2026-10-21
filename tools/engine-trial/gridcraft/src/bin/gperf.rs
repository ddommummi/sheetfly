use gridcraft_core::{CellRef, Value};
use std::time::Instant;
fn main() {
    let path = std::env::args().nth(1).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let t = Instant::now();
    let (mut wb, _) = gridcraft_xlsx::read_xlsx(&bytes).unwrap();
    println!("읽기 {:.0}ms (셀 {})", t.elapsed().as_secs_f64() * 1000.0, wb.sheets.iter().map(|s| s.cells.len()).sum::<usize>());
    let mut calc = gridcraft_calc::Calc::new();
    let t = Instant::now(); calc.recalc_all(&mut wb); println!("전체 재계산 {:.0}ms", t.elapsed().as_secs_f64() * 1000.0);
    let show = |wb: &gridcraft_model::Workbook, s: usize, r: u32, c: u32| format!("{:?}", wb.sheets[s].cells.get(CellRef::new(r, c)).map(|x| x.value.clone()));
    println!("Sum!B1 = {}", show(&wb, 2, 0, 1));
    // 한 칸 바꾸고 증분 재계산(Data!A열)
    let mut times = vec![];
    for i in 0..20u32 {
        let row = 4 + i * 37;
        let sh = std::sync::Arc::make_mut(&mut wb.sheets[0]);
        let cell = CellRef::new(row, 0);
        let old = sh.cells.get(cell).map(|c| c.value.clone()).unwrap_or(Value::Empty);
        let nv = match old { Value::Number(n) => Value::Number(n + 500.0), v => v };
        sh.set_value(cell, nv);
        let t = Instant::now(); calc.cells_changed(&mut wb, &[(0, cell)]); times.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("한 칸 수정 후 증분 재계산 p50 {:.1}ms p95 {:.1}ms max {:.1}ms", times[times.len() / 2], times[times.len() * 95 / 100], times[times.len() - 1]);
    println!("Sum!B1 = {}", show(&wb, 2, 0, 1));
    let t = Instant::now(); let out = gridcraft_xlsx::write_xlsx(&wb).unwrap(); println!("저장 {:.0}ms ({} bytes)", t.elapsed().as_secs_f64() * 1000.0, out.len());
}
