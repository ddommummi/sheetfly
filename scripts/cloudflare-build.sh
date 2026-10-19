#!/usr/bin/env bash
# Git 연동 빌드(Cloudflare Workers Builds 등)에서 웹 앱을 "깨끗한 환경에서 처음부터" 빌드한다.
#   1) rhwp 희소 체크아웃·office_oxide 받기  2) Rust(고정 툴체인) 설치  3) wasm-bindgen-cli(사전 빌드본)  4) npm ci
#   5) WASM 빌드(HWP 엔진 rhwp + DOCX 엔진 fmt-docx)  6) 웹 빌드 → apps/web/dist
# Workers Builds 설정: Root directory = apps/web, Build command = `bash ../../scripts/cloudflare-build.sh`,
#                      Deploy command = `npx wrangler deploy` (기본값). 자세한 절차: docs/deploy-cloudflare.md
# 환경변수: WASM_OPT=0(기본)이면 wasm-opt를 건너뛴다(빌드 약 6분 절약, brotli +4%). 1이면 적용.
# Workers Builds는 빌드 제한 시간이 20분이고 Rust 캐시가 없어서(문서 확인) 기본은 시간 절약 쪽이다.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
export WASM_OPT="${WASM_OPT:-0}"
TC="${RUSTUP_TOOLCHAIN:-1.93.1}"
t0=$(date +%s)
step() { printf '\n[%4ds] %s\n' "$(( $(date +%s) - t0 ))" "$*"; }

step "1/6 rhwp 소스 (희소 체크아웃) + office_oxide"
scripts/fetch-rhwp.sh
scripts/fetch-office-oxide.sh

step "2/6 Rust $TC + wasm32 타깃"
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none >/dev/null
fi
rustup toolchain install "$TC" --profile minimal -t wasm32-unknown-unknown >/dev/null 2>&1 || rustup toolchain install "$TC" --profile minimal -t wasm32-unknown-unknown
export RUSTUP_TOOLCHAIN="$TC"
rustc --version

step "3/6 wasm-bindgen-cli (rhwp Cargo.lock과 같은 버전)"
want="$(awk '/^name = "wasm-bindgen"$/{getline; gsub(/"/,"",$3); print $3; exit}' third_party/rhwp/Cargo.lock)"
if ! command -v wasm-bindgen >/dev/null 2>&1 || [ "$(wasm-bindgen --version | awk '{print $2}')" != "$want" ]; then
  bin="$HOME/.cargo/bin"; mkdir -p "$bin"
  name="wasm-bindgen-$want-x86_64-unknown-linux-musl"
  if curl -sSfL -m 180 "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$want/$name.tar.gz" | tar xz -C "$bin" --strip-components=1 "$name/wasm-bindgen" 2>/dev/null; then
    chmod +x "$bin/wasm-bindgen"
  else
    echo "사전 빌드본을 받지 못해 cargo install로 대체한다 (느림)" >&2
    cargo install wasm-bindgen-cli --version "$want" --locked
  fi
fi
wasm-bindgen --version

step "4/6 npm ci"
( cd apps/web && npm ci --no-audit --no-fund )

step "5/6 WASM 빌드 (WASM_OPT=$WASM_OPT): HWP 엔진, DOCX 엔진"
scripts/build-wasm.sh
scripts/build-docx-wasm.sh

step "6/6 웹 빌드"
( cd apps/web && node scripts/build.mjs )

step "완료"
ls -l apps/web/dist/assets | awk 'NR>1{print $5, $9}'
