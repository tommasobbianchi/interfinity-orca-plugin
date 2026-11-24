"""Verify generated tiles against the user's original Interfinity meshes."""
import json, subprocess, sys, os, glob
import numpy as np
sys.path.insert(0, os.environ["SCRATCH"])
from load import load
from outline import outline
from collections import Counter
here=os.path.dirname(os.path.abspath(__file__))
tmp=os.path.join(os.environ["SCRATCH"],"gen.json")
subprocess.check_call(["node",os.path.join(here,"dump.js"),tmp])
gen=json.load(open(tmp))
def vol(v,t):
    a=v[t]; return np.einsum('ij,ij->i',a[:,0],np.cross(a[:,1],a[:,2])).sum()/6
def manifold(t):
    e=Counter()
    for tr in t:
        for a,b in ((0,1),(1,2),(2,0)): e[(tr[a],tr[b])]+=1
    bad=[k for k,c in e.items() if c!=1 or (k[1],k[0]) not in e]
    return len(bad)
def area(P):
    x,y=P[:,0],P[:,1]; return 0.5*abs(np.dot(x,np.roll(y,-1))-np.dot(y,np.roll(x,-1)))
ref={'1x1_cl04':'b/3D/Objects/Design Body_2.model'}
for k,f in {'4x1':'1_4','3x2':'2_5','2x2':'3_6','2x1':'4_7','1x1':'5_8'}.items():
    ref[k]='a/3D/Objects/Design Body '+f.replace('_',' ',0)+'.model'
    ref[k]='a/3D/Objects/Design Body %s.model'%({'4x1':'1_4','3x2':'2_5','2x2':'3_6','2x1':'4_7','1x1':'5_8'}[k])
ok=True
for name,g in gen.items():
    v=np.array(g['v']).reshape(-1,3); t=np.array(g['t']).reshape(-1,3)
    bad=manifold(t); V=vol(v,t)
    line=f"{name}: tris={len(t)} nonmanifold_edges={bad} vol={V:.0f} bbox={v.min(0)}..{v.max(0)}"
    if bad or V<=0: ok=False
    r=ref.get(name)
    if r:
        rv,rt=load(os.path.join(os.environ["SCRATCH"],r))
        rV=vol(rv,rt)
        O=outline(os.path.join(os.environ["SCRATCH"],r))
        # align: ref core origin = bbox min
        O=O-rv.min(0)[:2]
        # Hausdorff-ish: each ref outline point distance to generated outline polyline
        n=len(t)  # unused
        top=v[v[:,2]>1][:,:2]
        def dist_to_poly(p,P):
            a=P; b=np.roll(P,-1,0); ab=b-a; ap=p-a
            tt=np.clip((ap*ab).sum(1)/(ab*ab).sum(1),0,1)
            return np.min(np.linalg.norm(a+ab*tt[:,None]-p,axis=1))
        import numpy as _n
        GO=top  # vertices only; use full outline from polygon order
        sys.path.insert(0,here)
        Pn=_n.array(subprocess.check_output(["node","-e",f"const G=require('{here}/../src/geometry.js');const w={name[0]},d={name[2]};console.log(JSON.stringify(G.tileOutline(w,d,{{}})))"]).decode() and json.loads(subprocess.check_output(["node","-e",f"const G=require('{here}/../src/geometry.js');console.log(JSON.stringify(G.tileOutline({name[0]},{name[2]},{{clearance:{0.4 if 'cl04' in name else 0.5}}})))"])))
        h=max(dist_to_poly(p,Pn) for p in O)
        line+=f" | ref vol={rV:.0f} ({100*(V/rV-1):+.2f}%) maxdev(ref outline->gen)={h:.3f} mm"
        if h>0.05 or abs(V/rV-1)>0.01: ok=False
    print(line)
print("PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
