# GridCraft 엔진 시험 (2026-10-21)

결과와 해석: `docs/phase4/trial-gridcraft.md`. 이 폴더는 시험 도구만 담는다(GridCraft 코드는 넣지 않는다).

```
git clone --depth 1 https://github.com/storytold/gridcraft            # 시험한 커밋 37e4142(2026-10-21)
sed -i "s#GRIDCRAFT#$PWD/gridcraft#" Cargo.toml                       # 이 폴더의 Cargo.toml이 경로를 가리키게
cargo build --release --bins                                          # 네이티브(재계산·저장 왕복·서식·속도)
cargo build --release --target wasm32-unknown-unknown --lib           # WASM 크기

python3 battery.py battery.xlsx && soffice --headless --convert-to xlsx --outdir lo battery.xlsx   # 함수 186개(LibreOffice가 계산한 값이 기준)
echo "$PWD/lo/battery.xlsx" > l.txt && mkdir out && EXMAX=400 target/release/gnative l.txt out        # 캐시값과 GridCraft 재계산 비교
target/release/gfmt fmts.tsv                                          # 숫자 서식(한국어) 출력
python3 korean.py                                                     # 한국어 견적서·월별 매출·차트 → LibreOffice로 변환 → gnative → PDF로 눈 비교
target/release/gperf big.xlsx                                         # 10만 줄 통합 문서 재계산 시간(python3 big.py로 만든다)
```
