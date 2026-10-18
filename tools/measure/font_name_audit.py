#!/usr/bin/env python3
"""폰트 파일 내부 name 테이블의 저작권/라이선스 문자열을 뽑아 표로 만든다.
사용: font_name_audit.py <폰트 디렉터리> ...   (fonttools + brotli 필요)
name ID: 0=저작권, 1=패밀리, 13=라이선스 설명, 14=라이선스 URL.
"""
import sys, glob, os
from fontTools.ttLib import TTFont

def s(font, nid):
    n = font['name']
    for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0), (3, 10, 0x409)):
        r = n.getName(nid, pid, eid, lid)
        if r:
            try:
                return str(r).replace('\n', ' ').strip()
            except Exception:
                pass
    r = next((x for x in n.names if x.nameID == nid), None)
    return str(r).replace('\n', ' ').strip() if r else ''

for d in sys.argv[1:]:
    for f in sorted(glob.glob(os.path.join(d, '*'))):
        if not f.lower().endswith(('.woff2', '.woff', '.ttf', '.otf', '.ttc')):
            continue
        try:
            font = TTFont(f, fontNumber=0)
        except Exception as e:
            print(f"{os.path.basename(f)}\tERROR {e}")
            continue
        print("\t".join([os.path.basename(f), s(font, 1), s(font, 0)[:110], s(font, 13)[:90], s(font, 14)[:60]]))
