#!/usr/bin/env bash
# office_oxide(서브모듈)를 WASM으로 빌드해 웹 앱이 가져다 쓸 수 있게 만든다 (DOCX/XLSX/PPTX → IR).
#   cargo build(릴리스, --features wasm) → wasm-bindgen(web) → wasm-opt -Oz(명시 기능 목록)
# 사용: scripts/build-docx-wasm.sh [출력 디렉터리]   (기본: apps/web/src/wasm)
# 환경변수: WASM_OPT=0 이면 wasm-opt를 건너뛴다. 기본 1 (이 모듈은 작아 1분 남짓).
# wasm-bindgen CLI는 office_oxide Cargo.lock의 버전을 scripts/ensure-wasm-bindgen.sh가 준비한다.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/apps/web/src/wasm}"
oo="$root/third_party/office_oxide"
tc="${RUSTUP_TOOLCHAIN:-1.93.1}"          # rhwp와 같은 툴체인 (office_oxide MSRV 1.88 이상)
target_dir="${CARGO_TARGET_DIR:-$root/target/office-oxide-wasm}"
use_opt="${WASM_OPT:-1}"
wasm_opt="$root/apps/web/node_modules/.bin/wasm-opt"
[ -x "$wasm_opt" ] || wasm_opt="$(command -v wasm-opt || true)"
if [ "$use_opt" != 0 ] && [ -z "$wasm_opt" ]; then echo "wasm-opt가 없다: apps/web에서 npm install (또는 WASM_OPT=0)" >&2; exit 1; fi

want="$(awk '/^name = "wasm-bindgen"$/{getline; gsub(/"/,"",$3); print $3; exit}' "$oo/Cargo.lock")"
bindgen="$("$root/scripts/ensure-wasm-bindgen.sh" "$want")"

echo "[1/3] cargo build (office_oxide, 툴체인 $tc)"
( cd "$oo" && RUSTUP_TOOLCHAIN="$tc" CARGO_TARGET_DIR="$target_dir" \
    cargo build --release --lib --locked --target wasm32-unknown-unknown --features wasm )

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo "[2/3] wasm-bindgen $want"
"$bindgen" --target web --no-typescript --out-dir "$tmp" "$target_dir/wasm32-unknown-unknown/release/office_oxide.wasm"

if [ "$use_opt" != 0 ]; then
  echo "[3/3] wasm-opt -Oz"
  "$wasm_opt" -Oz \
    --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
    --enable-nontrapping-float-to-int --enable-multivalue --enable-reference-types \
    "$tmp/office_oxide_bg.wasm" -o "$tmp/office_oxide_bg.opt.wasm"
else
  echo "[3/3] wasm-opt 건너뜀 (WASM_OPT=0)"
  cp "$tmp/office_oxide_bg.wasm" "$tmp/office_oxide_bg.opt.wasm"
fi

mkdir -p "$out"
cp "$tmp/office_oxide.js" "$out/office_oxide.js"
cp "$tmp/office_oxide_bg.opt.wasm" "$out/office_oxide_bg.wasm"
sha="$(sha256sum "$out/office_oxide_bg.wasm" | awk '{print $1}')"
cat > "$out/BUILD_INFO_DOCX.json" <<JSON
{
  "officeOxideCommit": "$(git -C "$oo" rev-parse HEAD)",
  "toolchain": "$tc",
  "wasmBindgen": "$want",
  "wasmOpt": "$([ "$use_opt" != 0 ] && "$wasm_opt" --version | head -n1 || echo skipped)",
  "wasmSha256": "$sha"
}
JSON
echo "완료: $out (office_oxide_bg.wasm sha256 $sha)"
