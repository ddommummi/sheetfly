# rhwp 패치

서브모듈 `third_party/rhwp`는 원본 그대로 두고, 이 폴더의 `*.patch`를 **빌드 때만** 작업 트리에 얹는다.
운영 규칙과 갱신 절차는 [`docs/patches/README.md`](../../docs/patches/README.md).

```sh
scripts/rhwp-patches.sh status   # applied | pending | conflict
scripts/rhwp-patches.sh apply    # 얹기(이미 있으면 건너뜀)
scripts/rhwp-patches.sh revert   # 걷어 내기(서브모듈을 원본으로)
RHWP_PATCHES=0 scripts/build-wasm.sh   # 패치 없이 빌드(비교용)
```

새 패치는 `NNNN-이름.patch`(git apply 형식, 경로는 rhwp 루트 기준 `a/`·`b/`)로 만들고 머리에 무엇·왜·확인·되돌리기를 적는다. `rhwp` 소스를 고친 뒤 `diff -u --label a/<경로> --label b/<경로> 원본 수정본`으로 뽑으면 된다.

## 영향 범위 확인 (패치마다)
네이티브 `rhwp` 바이너리 두 개(패치 전·후)를 만들어 `rhwp/samples`의 모든 `.hwp`·`.hwpx`에 `rhwp dump-pages <파일>`을 돌려 출력을 비교한다. 달라지는 파일만 쪽 수와 그림으로 직접 본다(0001: 1,205개 중 2개).
