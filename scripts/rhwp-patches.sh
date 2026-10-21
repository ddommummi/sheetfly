#!/usr/bin/env bash
# rhwp(서브모듈) 위에 우리 패치(tools/rhwp-patches/*.patch)를 얹거나 걷어 낸다.
#   scripts/rhwp-patches.sh apply   적용한다. 이미 적용돼 있으면 건너뛴다. 맞지 않으면 실패한다.
#   scripts/rhwp-patches.sh revert  적용돼 있는 패치만 거꾸로 되돌려 서브모듈 작업 트리를 원본으로 되돌린다.
#   scripts/rhwp-patches.sh status  패치별 상태(applied / pending / CONFLICT)를 출력한다.
#   scripts/rhwp-patches.sh list    패치 파일 이름과 sha256을 출력한다(BUILD_INFO용).
# 서브모듈 커밋은 원본 그대로 두고 빌드 때만 작업 트리에 얹는다(docs/patches/README.md).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/third_party/rhwp"
dir="$root/tools/rhwp-patches"
shopt -s nullglob
patches=("$dir"/*.patch)

state() { # 인자: 패치 경로 → applied | pending | conflict
  if git -C "$dest" apply --reverse --check "$1" 2>/dev/null; then echo applied
  elif git -C "$dest" apply --check "$1" 2>/dev/null; then echo pending
  else echo conflict; fi
}

case "${1:-status}" in
  apply)
    for p in "${patches[@]}"; do
      case "$(state "$p")" in
        applied) echo "이미 적용됨: $(basename "$p")" ;;
        pending) git -C "$dest" apply "$p"; echo "적용: $(basename "$p")" ;;
        conflict) echo "패치가 맞지 않는다: $(basename "$p") — 업스트림이 바뀌었다. docs/patches/README.md의 갱신 절차를 따른다." >&2; exit 1 ;;
      esac
    done ;;
  revert)
    for ((i=${#patches[@]}-1; i>=0; i--)); do
      p="${patches[$i]}"
      if [ "$(state "$p")" = applied ]; then git -C "$dest" apply --reverse "$p"; echo "되돌림: $(basename "$p")"; fi
    done ;;
  status)
    for p in "${patches[@]}"; do printf '%s\t%s\n' "$(state "$p")" "$(basename "$p")"; done ;;
  list)
    for p in "${patches[@]}"; do printf '%s %s\n' "$(sha256sum "$p" | cut -d' ' -f1)" "$(basename "$p")"; done ;;
  *) echo "사용: $0 apply|revert|status|list" >&2; exit 2 ;;
esac
