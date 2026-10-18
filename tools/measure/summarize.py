#!/usr/bin/env python3
"""browser-bench.cjs 결과 JSON을 요약한다 (p50/p95, 오류 수). 사용: summarize.py out.json [min_bytes]"""
import json, statistics, sys

def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return float('nan')
    k = (len(xs) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)

d = json.load(open(sys.argv[1]))
min_bytes = int(sys.argv[2]) if len(sys.argv) > 2 else 0
rs = [r for r in d['results'] if r['size'] >= min_bytes]
ok = [r for r in rs if 'error' not in r]
print(f"init: {d['init']}")
print(f"files: {len(rs)}  ok: {len(ok)}  errors: {len(rs) - len(ok)}  (min_bytes={min_bytes})")
for r in rs:
    if 'error' in r:
        print("  ERR", r['rel'], r['error'])
def row(name, xs):
    print(f"{name:<22} p50={pct(xs,50):8.1f}  p95={pct(xs,95):8.1f}  max={max(xs) if xs else float('nan'):8.1f}  n={len(xs)}")
row("open (ms)", [r['openMs'] for r in ok])
row("pageCount (ms)", [r['pageCountMs'] for r in ok])
row("first page SVG (ms)", [r['pageSvgMs'][0] for r in ok if r['pageSvgMs']])
row("first page total (ms)", [r['firstPageTotalMs'] for r in ok])
row("per-page SVG (ms)", [t for r in ok for t in r['pageSvgMs']])
row("per-page Canvas2D (ms)", [t for r in ok for t in r.get('pageCanvasMs', [])])
row("measureText calls/doc", [r['measureCalls'] for r in ok if 'measureCalls' in r])
row("measureText ms/doc", [r['measureMs'] for r in ok if 'measureMs' in r])
print("pages total:", sum(r['pages'] for r in ok), " max pages:", max((r['pages'] for r in ok), default=0))
