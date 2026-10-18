import csv, re, sys, collections
rows = list(csv.reader(open(sys.argv[1], encoding='utf-8')))
hdr, rows = rows[0], rows[1:]
agg = collections.Counter(); cnt = collections.Counter()
total = 0
for r in rows:
    try: size = int(r[1])
    except: continue
    name = r[0]
    total += size
    m = re.match(r'^(?:<)?(?:impl )?(rhwp::[a-z_0-9]+(?:::[a-z_0-9]+)?)', name)
    if name.startswith('data segment') or name.startswith('"function names"') or name.startswith('table[') or name.startswith('elem['):
        key = name.split('"')[0].strip() + ' ' + (re.findall(r'"[^"]*"', name) or [''])[0]
    elif m: key = m.group(1)
    else:
        m2 = re.match(r'^(?:<)?([a-z_0-9]+)::', name)
        key = 'ext:' + m2.group(1) if m2 else 'other'
    # collapse rhwp:: to 2 levels only for big ones
    agg[key] += size; cnt[key] += 1
print("total", total)
for k, v in agg.most_common(int(sys.argv[2]) if len(sys.argv)>2 else 45):
    print(f"{v:>9} {100*v/total:5.1f}%  n={cnt[k]:<6} {k}")
