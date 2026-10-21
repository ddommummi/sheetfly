#!/bin/sh
# 공개 DOCX 시험 파일을 얕게(필요한 폴더만) 받는다. 파일은 저장소에 넣지 않는다(용량·라이선스). 사용: sh fetch-docx-corpus.sh <받을 폴더>
#   Apache POI(Apache-2.0), Apache Tika(Apache-2.0), python-docx(MIT), Open XML SDK(MIT)의 시험 파일.
#   측정: node tools/edit-spike/docx-corpus.mjs <받은 폴더>
set -e
out=${1:?받을 폴더}; mkdir -p "$out"; cd "$out"
get() { n=$1; u=$2; shift 2; [ -d "$n" ] && return 0; git clone -q --depth 1 --filter=blob:none --sparse "$u" "$n" && (cd "$n" && git sparse-checkout set "$@" && git checkout -q); }
get poi https://github.com/apache/poi.git test-data/document &
get tika https://github.com/apache/tika.git tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/resources/test-documents &
get python-docx https://github.com/python-openxml/python-docx.git tests features &
get open-xml-sdk https://github.com/dotnet/Open-XML-SDK.git test &
wait
