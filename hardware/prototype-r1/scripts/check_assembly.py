#!/usr/bin/env python3
"""Check closed assembly and sampled single-lid opening positions using CAD CSG."""
from pathlib import Path
import concurrent.futures, json, subprocess, tempfile
from export_models import ROOT, SCAD, OPENSCAD

CASES=[('closed','interference',{})]+[(f'lid-{i}-{a}deg','motion_interference',{'slot_number':i,'open_angle':a}) for i in range(1,9) for a in [0,30,60,90,100]]
def check(case):
 name,part,params=case
 with tempfile.TemporaryDirectory(prefix='pillbox-csg-') as t:
  out=Path(t)/'intersection.stl'
  cmd=[OPENSCAD,'--hardwarnings','-o',str(out),'-D',f'part="{part}"']
  for k,v in params.items(): cmd+=['-D',f'{k}={v}']
  r=subprocess.run(cmd+[str(SCAD)],text=True,capture_output=True)
  log=r.stdout+r.stderr
  passed='Current top level object is empty.' in log and not out.exists() and 'WARNING' not in log and 'ERROR' not in log
  return dict(case=name,passed=passed,result='empty intersection' if passed else log[-1200:])
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: reports=list(pool.map(check,CASES))
(ROOT/'validation/assembly-report.json').write_text(json.dumps(reports,indent=2))
print('CAD intersections:',sum(r['passed'] for r in reports),'/',len(reports),'passed')
for r in reports:
 if not r['passed']: print(r)
assert all(r['passed'] for r in reports)
