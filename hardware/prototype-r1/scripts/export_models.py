#!/usr/bin/env python3
"""Rebuild printable STL and actual-CAD PNG views. Python standard library only."""
from pathlib import Path
import argparse, concurrent.futures, json, os, shutil, subprocess

ROOT = Path(__file__).resolve().parents[1]
SCAD = ROOT / 'cad/pillbox.scad'
OPENSCAD = os.environ.get('OPENSCAD') or shutil.which('openscad') or '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'
PARTS = [
    ('01-base', 'base', 1, {}), ('02-deck', 'deck', 1, {}),
    ('03-cup', 'cup', 8, {}),
    *[(f'04-lid-{i}', 'lid', 1, {'slot_number': i}) for i in range(1,9)],
    ('05-magnet-cap', 'magnet_cap', 8, {}),
    ('06-electronics-carrier', 'carrier', 1, {}),
    ('07-oled-backplate', 'oled_backplate', 1, {}),
    ('08-oled-spacer', 'spacer', 4, {}),
    ('09-fit-coupon', 'coupon', 1, {}),
    ('10-single-cell-fixture', 'one_cell_fixture', 1, {}),
]

def command(out, part, values=None, extra=None):
    cmd = [OPENSCAD, '--hardwarnings', '-o', str(out), '-D', f'part="{part}"']
    for k,v in (values or {}).items(): cmd += ['-D', f'{k}={v}']
    cmd += extra or []
    cmd.append(str(SCAD))
    r = subprocess.run(cmd, capture_output=True, text=True)
    (ROOT/'validation'/f'{out.stem}.log').write_text(r.stdout+r.stderr)
    if r.returncode: raise RuntimeError(f'{out.name}: {r.stderr[-1200:]}')
    return out

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--views-only',action='store_true'); args=ap.parse_args()
    for d in ['stl','views','validation']: (ROOT/d).mkdir(exist_ok=True)
    if not args.views_only:
        def job(p):
            name,part,qty,values=p
            command(ROOT/'stl'/f'{name}.stl',part,values,['--export-format','binstl'])
            return {'file':f'stl/{name}.stl','quantity':qty,'part':part,'parameters':values}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            manifest=list(pool.map(job,PARTS))
        (ROOT/'cad/print-manifest.json').write_text(json.dumps(manifest,indent=2))
    views=[
        ('01-assembled','assembly',{},'108,92,30,58,0,28,540'),
        ('02-open-lid','assembly',{'open_angle':100},'108,92,42,58,0,28,570'),
        ('03-exploded','assembly',{'explode':42},'108,92,85,62,0,28,700'),
        ('04-section','section',{},'108,92,30,64,0,40,540'),
        ('05-top','assembly',{},'108,92,30,0,0,0,480'),
    ]
    for name,part,values,camera in views:
        command(ROOT/'views'/f'{name}.png',part,values,
                ['--imgsize','1400,1100','--camera',camera,'--projection','o','--colorscheme','Tomorrow','--render=true'])
    print('Exported STL parts and 5 CAD views to', ROOT)

if __name__=='__main__': main()
