#!/usr/bin/env bash
# 지정한 버전의 wasm-bindgen CLI 경로를 출력한다 (없으면 사전 빌드본을 받고, 실패하면 cargo install).
# rhwp(0.2.127)와 office_oxide(0.2.129)가 서로 다른 버전을 요구하므로 버전별로 target/tools 아래에 둔다.
# 사용: scripts/ensure-wasm-bindgen.sh 0.2.129   → 실행 파일 경로
set -euo pipefail
ver="${1:?버전 필요}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/target/tools/wasm-bindgen-$ver"
bin="$dir/wasm-bindgen"
if [ -x "$bin" ] && [ "$("$bin" --version | awk '{print $2}')" = "$ver" ]; then echo "$bin"; exit 0; fi
mkdir -p "$dir"
name="wasm-bindgen-$ver-x86_64-unknown-linux-musl"
if curl -sSfL -m 180 "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$ver/$name.tar.gz" | tar xz -C "$dir" --strip-components=1 "$name/wasm-bindgen" 2>/dev/null; then
  chmod +x "$bin"
else
  echo "사전 빌드본을 받지 못해 cargo install로 되돌아간다 (수 분)" >&2
  cargo install wasm-bindgen-cli --version "$ver" --locked --root "$dir.cargo" >&2
  cp "$dir.cargo/bin/wasm-bindgen" "$bin"
fi
[ "$("$bin" --version | awk '{print $2}')" = "$ver" ] || { echo "wasm-bindgen $ver 준비 실패" >&2; exit 1; }
echo "$bin"
