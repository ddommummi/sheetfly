#!/usr/bin/env bash
# GenOffice(genspark-ai/genoffice, Apache-2.0)의 docx-engine을 시험용으로 번들할 작업 폴더(work/)를 만든다.
# GenOffice 소스는 이 저장소에 복사하지 않는다: 바깥 체크아웃(GENOFFICE_DIR)에서 work/(gitignore)로 읽기만 복사한다.
#   GENOFFICE_DIR=/path/to/genoffice tools/engine-trial/genoffice/setup.sh
# 만드는 것: work/out-node.mjs (parseDocx·saveDocx·sectionSettingsFromXml, Node용 번들), work/entry-*.ts (축소 실험 입구)
# 필요: node 22+, npm(레지스트리 접근). 고정 버전은 GenOffice docx-engine의 package.json 범위 안의 값이다.
set -euo pipefail
ge="${GENOFFICE_DIR:?GENOFFICE_DIR에 genspark-ai/genoffice 체크아웃 경로를 지정한다}"
here="$(cd "$(dirname "$0")" && pwd)"
work="$here/work"
[ -d "$ge/packages/docx-engine/src" ] || { echo "docx-engine을 찾지 못했다: $ge" >&2; exit 1; }

rm -rf "$work"
mkdir -p "$work/packages" "$work/node_modules/@genoffice"
# docx-engine이 워크스페이스로 끌어오는 패키지는 이 네 개뿐이다(소스와 package.json만, 시험 제외).
for p in docx-engine pptx-engine zip-gate agent-core; do
  mkdir -p "$work/packages/$p"
  cp -r "$ge/packages/$p/src" "$ge/packages/$p/package.json" "$work/packages/$p/"
done
echo "genoffice $(git -C "$ge" rev-parse HEAD 2>/dev/null || echo unknown)" > "$work/SOURCE"

echo '{"name":"genoffice-trial","private":true,"type":"module"}' > "$work/package.json"
( cd "$work" && npm install --no-audit --no-fund --silent esbuild@0.25.0 jszip@3.10.1 fast-xml-parser@5.3.4 utif2@4.1.0 )
# npm install이 package.json에 없는 링크를 지우므로 설치 뒤에 만든다.
for p in docx-engine pptx-engine zip-gate agent-core; do ln -sfn "../../packages/$p" "$work/node_modules/@genoffice/$p"; done

cat > "$work/entry-parse.ts" <<'EOF'
export { parseDocx } from '@genoffice/docx-engine'
EOF
cat > "$work/entry-parse-save.ts" <<'EOF'
export { parseDocx, saveDocx } from '@genoffice/docx-engine'
EOF
cat > "$work/entry-node.ts" <<'EOF'
export { parseDocx, saveDocx, sectionSettingsFromXml } from '@genoffice/docx-engine'
EOF
( cd "$work" && ./node_modules/.bin/esbuild entry-node.ts --bundle --format=esm --platform=node --target=node22 --outfile=out-node.mjs --log-level=error )
echo "준비 완료: $work ($(cat "$work/SOURCE"))"
