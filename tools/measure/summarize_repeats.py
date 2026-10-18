#!/usr/bin/env python3
"""반복 실행한 browser-bench 결과(fair-<변형>-<n>.json)의 지표별 p50/p95를 실행마다 계산해 중앙값으로 요약한다.
사용: summarize_repeats.py <결과 디렉터리> <접두어> <변형...>   예: summarize_repeats.py . fair2 base base-Oz z-Oz
"""
import json, os, statistics, sys

def pct(xs, p):
    xs = sorted(xs); k = (len(xs) - 1) * p / 100; f = int(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)

d, prefix, variants = sys.argv[1], sys.argv[2], sys.argv[3:]
for v in variants:
    cols = {}
    for rep in range(1, 10):
        fn = os.path.join(d, f"{prefix}-{v}-{rep}.json")
        if not os.path.exists(fn):
            continue
        j = json.load(open(fn))
        ok = [r for r in j['results'] if 'error' not in r]
        cols.setdefault('wasm_init', []).append(j['init']['wasmInitMs'])
        cols.setdefault('open_p50', []).append(pct([r['openMs'] for r in ok], 50))
        cols.setdefault('open_p95', []).append(pct([r['openMs'] for r in ok], 95))
        cols.setdefault('first_page_total_p50', []).append(pct([r['firstPageTotalMs'] for r in ok], 50))
        cols.setdefault('first_page_total_p95', []).append(pct([r['firstPageTotalMs'] for r in ok], 95))
        cols.setdefault('svg_page_p50', []).append(pct([t for r in ok for t in r['pageSvgMs']], 50))
        cols.setdefault('svg_page_p95', []).append(pct([t for r in ok for t in r['pageSvgMs']], 95))
        cols.setdefault('canvas_page_p50', []).append(pct([t for r in ok for t in r['pageCanvasMs']], 50))
        cols.setdefault('canvas_page_p95', []).append(pct([t for r in ok for t in r['pageCanvasMs']], 95))
    print(f"[{v}] runs={len(cols.get('open_p50', []))}")
    for k, xs in cols.items():
        print(f"  {k:22s} " + " ".join(f"{x:8.1f}" for x in xs) + f"   median {statistics.median(xs):8.1f}")
