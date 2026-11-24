#!/bin/sh
# Slice generated tiles with a real OrcaSlicer CLI in vase mode and compare the
# extruded path per revolution with the outline perimeter.
# usage: ORCA=/path/to/orca-slicer ./run.sh   (needs node + python3)
set -e; cd "$(dirname "$0")"; ORCA=${ORCA:-orca-slicer}; mkdir -p out
node -e "
const G=require('../../src/geometry.js'),fs=require('fs');
const c={plain_2x1:[2,1,{}],div_y_2x2:[2,2,{divDir:'y'}],div_y5_3x2:[3,2,{divDir:'y',divEvery:5}],div_x_2x3:[2,3,{divDir:'x'}],gap005:[2,2,{divDir:'y',divGap:0.05}],gap02:[2,2,{divDir:'y',divGap:0.2}]};
for(const [k,[w,d,p]] of Object.entries(c)){p.height=20;fs.writeFileSync('out/'+k+'.stl',Buffer.from(G.toSTL(G.tileMesh(w,d,p),true)));
 const o=G.tileOutline(w,d,p);let s=0;for(let i=0;i<o.length;i++){const q=o[(i+1)%o.length];s+=Math.hypot(q[0]-o[i][0],q[1]-o[i][1]);}
 fs.appendFileSync('out/perimeters.txt',k+' '+s.toFixed(0)+'\n');}"
for f in out/*.stl; do n=$(basename $f .stl)
  $ORCA --datadir /tmp/orcadata --slice 0 --load-settings "machine.json;process.json" --load-filaments filament.json --outputdir out $f >/dev/null 2>&1
  mv out/plate_1.gcode out/$n.gcode; done
python3 - <<'P'
import re,math
per=dict(l.split() for l in open("out/perimeters.txt"))
for n,p in per.items():
    x=y=z=0;ext=0;trav=0
    for l in open(f"out/{n}.gcode"):
        m=re.match(r"G[01] (.*)",l)
        if not m: continue
        a=dict((t[0],float(t[1:])) for t in m.group(1).split() if re.match(r"[XYZE]-?[\d.]+",t))
        nx=a.get("X",x);ny=a.get("Y",y)
        if "Z" in a:z=a["Z"]
        if 2<z<19:
            if a.get("E",0)>0 and ("X" in a or "Y" in a): ext+=math.hypot(nx-x,ny-y)
            elif "X" in a or "Y" in a: trav+=1
        x,y=nx,ny
    print(f"{n:12s} outline perimeter {p:>5s} mm | printed per layer {ext/85:7.0f} mm | travel moves {trav}")
P
