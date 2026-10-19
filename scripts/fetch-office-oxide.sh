#!/usr/bin/env bash
# third_party/office_oxide(서브모듈)를 고정 커밋으로 받는다 (약 7MB). 이미 채워져 있으면 아무것도 안 한다.
# CI(GitHub Actions, Cloudflare Workers Builds)에서 서브모듈이 비어 있을 때 쓴다. 고정 커밋은 우리 저장소의 gitlink.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
dest="third_party/office_oxide"
sha="$(git ls-tree HEAD "$dest" | awk '{print $3}')"
url="$(git config -f .gitmodules submodule.$dest.url)"
[ -n "$sha" ] && [ -n "$url" ] || { echo "gitlink 또는 .gitmodules URL을 찾지 못했다" >&2; exit 1; }
if [ -f "$dest/Cargo.toml" ]; then
  have="$(git -C "$dest" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$have" = "$sha" ] || [ "$have" = unknown ]; then echo "office_oxide 이미 준비됨 ($have)"; exit 0; fi
fi
echo "office_oxide 받기: $url @ ${sha:0:10}"
rm -rf "$dest"
git init -q "$dest"
git -C "$dest" remote add origin "$url"
git -C "$dest" fetch --quiet --depth 1 origin "$sha"
git -C "$dest" checkout --quiet FETCH_HEAD
echo "완료: $(du -sh "$dest" | cut -d$'\t' -f1)"
