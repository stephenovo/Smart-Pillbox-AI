#!/usr/bin/env python3
"""Check binary STL topology, oriented edges, positive volume and build envelope."""
from pathlib import Path
from collections import defaultdict, Counter
import json, struct, math
ROOT=Path(__file__).resolve().parents[1]

def check(path):
    data=path.read_bytes(); n=struct.unpack_from('<I',data,80)[0]
    assert len(data)==84+50*n, f'Unexpected binary STL size: {path}'
    edges=defaultdict(list); vertices={}; faces=[]; volume=0; degenerate=0
    for i in range(n):
        v=struct.unpack_from('<12fH',data,84+50*i)[3:12]
        pts=[tuple(round(v[j+k],5) for k in range(3)) for j in [0,3,6]]
        ids=[vertices.setdefault(p,len(vertices)) for p in pts]; faces.append(ids)
        a,b,c=pts
        volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
        if len(set(ids))<3: degenerate+=1
        for u,w in zip(ids,ids[1:]+ids[:1]): edges[tuple(sorted([u,w]))].append((u,w,i))
    bad=sum(len(e)!=2 for e in edges.values())
    flipped=sum(len(e)==2 and e[0][:2]!=e[1][:2][::-1] for e in edges.values())
    adj=[[] for _ in faces]
    for ee in edges.values():
        if len(ee)==2:
            a,b=ee[0][2],ee[1][2]; adj[a].append(b); adj[b].append(a)
    seen=set(); components=0
    for i in range(n):
        if i in seen: continue
        components+=1; stack=[i]; seen.add(i)
        while stack:
            for j in adj[stack.pop()]:
                if j not in seen: seen.add(j); stack.append(j)
    points=list(vertices); bounds=[[min(p[k] for p in points),max(p[k] for p in points)] for k in range(3)]
    sizes=[round(b-a,3) for a,b in bounds]
    ok=bad==0 and flipped==0 and degenerate==0 and components==1 and volume>0 and sizes[0]<=256 and sizes[1]<=256
    return dict(file=path.name,triangles=n,watertight=bad==0,nonmanifold_edges=bad,
                inconsistent_edges=flipped,degenerate_triangles=degenerate,components=components,
                volume_mm3=round(volume,2),bounds_mm=bounds,size_mm=sizes,passed=ok)

if __name__=='__main__':
    reports=[check(p) for p in sorted((ROOT/'stl').glob('*.stl'))]
    (ROOT/'validation/mesh-report.json').write_text(json.dumps(reports,indent=2))
    for r in reports: print(r['file'],r['size_mm'],'PASS' if r['passed'] else 'FAIL',r['components'])
    assert len(reports)==17 and all(r['passed'] for r in reports), 'Mesh check failed'
