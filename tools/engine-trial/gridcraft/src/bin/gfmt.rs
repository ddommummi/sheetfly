use gridcraft_core::{DateSystem, Value};
use gridcraft_numfmt::{format_value, NumberFormat};
fn main() {
    let path = std::env::args().nth(1).unwrap();
    for line in std::fs::read_to_string(path).unwrap().lines() {
        let mut it = line.splitn(2, '\t');
        let (v, code) = (it.next().unwrap(), it.next().unwrap_or("General"));
        let val = match v.parse::<f64>() { Ok(n) => Value::Number(n), Err(_) => Value::from(v) };
        let f = format_value(&val, &NumberFormat::parse(code), DateSystem::D1900);
        println!("{}\t{}\t{}", v, code, f.text);
    }
}
