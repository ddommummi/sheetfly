#[unsafe(no_mangle)]
pub extern "C" fn probe(ptr: *const u8, len: usize) -> u32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let Ok((mut wb, _)) = gridcraft_xlsx::read_xlsx(bytes) else { return 0 };
    let mut calc = gridcraft_calc::Calc::new();
    calc.recalc_all(&mut wb);
    1
}
