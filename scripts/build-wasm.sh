#!/usr/bin/env bash
# rhwp(서브모듈)를 WASM으로 빌드해 웹 앱이 가져다 쓸 수 있게 만든다.
#   cargo build(릴리스, rhwp 자신의 프로필) → wasm-bindgen(web) → wasm-opt -Oz(명시 기능 목록)
# 사용: scripts/build-wasm.sh [출력 디렉터리]   (기본: apps/web/src/wasm)
# 필요: rustup(+ wasm32-unknown-unknown), wasm-bindgen-cli(rhwp Cargo.lock과 같은 버전), apps/web의 npm install(binaryen)
# 우리 패치(tools/rhwp-patches/*.patch)를 빌드 동안만 서브모듈 작업 트리에 얹고 끝나면 되돌린다(docs/patches/README.md).
# 환경변수: RHWP_PATCHES=0 이면 패치 없이 원본 그대로 빌드한다(비교용). 기본 1.
# 환경변수: WASM_OPT=0 이면 wasm-opt를 건너뛴다 (약 6분 절약, 전송 크기 +4%: brotli 3.13→3.26MB). 기본 1.
# 근거: docs/decisions.md D-005 (wasm-opt --all-features는 브라우저가 로드하지 못하는 산출물을 만든다)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/apps/web/src/wasm}"
rhwp="$root/third_party/rhwp"
tc="${RUSTUP_TOOLCHAIN:-1.93.1}"          # rhwp의 rust-toolchain.toml과 같다 (D-004)
target_dir="${CARGO_TARGET_DIR:-$root/target/rhwp-wasm}"
use_opt="${WASM_OPT:-1}"
wasm_opt="$root/apps/web/node_modules/.bin/wasm-opt"
[ -x "$wasm_opt" ] || wasm_opt="$(command -v wasm-opt || true)"
if [ "$use_opt" != 0 ] && [ -z "$wasm_opt" ]; then echo "wasm-opt가 없다: apps/web에서 npm install (또는 WASM_OPT=0)" >&2; exit 1; fi

want="$(awk '/^name = "wasm-bindgen"$/{getline; gsub(/"/,"",$3); print $3; exit}' "$rhwp/Cargo.lock")"
have="$(wasm-bindgen --version | awk '{print $2}')"
if [ "$want" != "$have" ]; then
  echo "wasm-bindgen-cli 버전 불일치: rhwp Cargo.lock=$want, 설치됨=$have" >&2
  echo "  cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi

use_patches="${RHWP_PATCHES:-1}"
patch_json="[]"
cleanup() { [ -n "${tmp:-}" ] && rm -rf "$tmp"; [ "$use_patches" != 0 ] && "$root/scripts/rhwp-patches.sh" revert >/dev/null || true; }
trap cleanup EXIT
if [ "$use_patches" != 0 ]; then
  "$root/scripts/rhwp-patches.sh" apply
  patch_json="$("$root/scripts/rhwp-patches.sh" list | awk 'BEGIN{printf "["} {printf "%s{\"name\": \"%s\", \"sha256\": \"%s\"}", (NR>1?", ":""), $2, $1} END{printf "]"}')"
fi

echo "[1/3] cargo build (rhwp, 툴체인 $tc)"
( cd "$rhwp" && RUSTUP_TOOLCHAIN="$tc" CARGO_TARGET_DIR="$target_dir" \
    cargo build --release --lib --locked --target wasm32-unknown-unknown )

tmp="$(mktemp -d)"
echo "[2/3] wasm-bindgen $have"
wasm-bindgen --target web --no-typescript --out-dir "$tmp" "$target_dir/wasm32-unknown-unknown/release/rhwp.wasm"

if [ "$use_opt" != 0 ]; then
  echo "[3/3] wasm-opt -Oz"
  "$wasm_opt" -Oz \
    --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
    --enable-nontrapping-float-to-int --enable-multivalue --enable-reference-types \
    "$tmp/rhwp_bg.wasm" -o "$tmp/rhwp_bg.opt.wasm"
else
  echo "[3/3] wasm-opt 건너뜀 (WASM_OPT=0)"
  cp "$tmp/rhwp_bg.wasm" "$tmp/rhwp_bg.opt.wasm"
fi

mkdir -p "$out"
cp "$tmp/rhwp.js" "$out/rhwp.js"
cp "$tmp/rhwp_bg.opt.wasm" "$out/rhwp_bg.wasm"
sha="$(sha256sum "$out/rhwp_bg.wasm" | awk '{print $1}')"
cat > "$out/BUILD_INFO.json" <<JSON
{
  "rhwpCommit": "$(git -C "$rhwp" rev-parse HEAD)",
  "rhwpPatches": $patch_json,
  "toolchain": "$tc",
  "wasmBindgen": "$have",
  "wasmOpt": "$([ "$use_opt" != 0 ] && "$wasm_opt" --version | head -n1 || echo skipped)",
  "wasmSha256": "$sha"
}
JSON
echo "완료: $out (rhwp_bg.wasm sha256 $sha)"
