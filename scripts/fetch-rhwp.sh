#!/usr/bin/env bash
# third_party/rhwp(서브모듈)를 "빌드에 필요한 파일만" 받아 고정 커밋에 맞춘다.
# 전체 서브모듈은 3GB가 넘지만(.git 3.3GB, 작업 트리 5.4GB) 아래 희소 체크아웃은 약 57MB, 수 초면 된다.
# CI(GitHub Actions, Cloudflare Workers Builds)에서 서브모듈이 비어 있을 때 쓴다. 이미 채워져 있으면 아무것도 안 한다.
# 고정 커밋은 우리 저장소의 gitlink(`git ls-tree HEAD third_party/rhwp`), URL은 .gitmodules에서 읽는다.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
dest="third_party/rhwp"

sha="$(git ls-tree HEAD "$dest" | awk '{print $3}')"
url="$(git config -f .gitmodules submodule.$dest.url)"
[ -n "$sha" ] && [ -n "$url" ] || { echo "gitlink 또는 .gitmodules URL을 찾지 못했다" >&2; exit 1; }

if [ -f "$dest/Cargo.toml" ] && [ -d "$dest/src" ]; then
  have="$(git -C "$dest" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$have" = "$sha" ] || [ "$have" = unknown ]; then echo "rhwp 이미 준비됨 ($have)"; exit 0; fi
fi

echo "rhwp 희소 체크아웃: $url @ ${sha:0:10}"
rm -rf "$dest"
GIT_LFS_SKIP_SMUDGE=1 git clone --quiet --filter=blob:none --no-checkout "$url" "$dest"
git -C "$dest" sparse-checkout init --no-cone
# 빌드(WASM/네이티브 lib)와 cargo 메타데이터가 읽는 경로. Cargo는 [[test]]/[[example]] 대상 파일과 워크스페이스
# 멤버 매니페스트가 있어야 로드되므로 tests/tools/bindings의 소스·매니페스트까지 포함한다. fuzz/는 퍼징 CI용.
git -C "$dest" sparse-checkout set \
  '/src/' '/crates/' '/vendor/' '/saved/' '/ttfs/opensource/' '/assets/logo/' \
  '/tests/*.rs' '/tests/cases/' '/tests/generated/' '/tests/fixtures/fonts/' \
  '/tools/**/*.rs' '/tools/**/Cargo.toml' '/bindings/' '/fuzz/' \
  '/Cargo.toml' '/Cargo.lock' '/build.rs' '/rust-toolchain.toml' '/LICENSE' '/THIRD_PARTY_LICENSES.md'
git -C "$dest" fetch --quiet --depth 1 origin "$sha" 2>/dev/null || true
git -C "$dest" checkout --quiet "$sha"
echo "완료: $(du -sh "$dest" | cut -f1)"
