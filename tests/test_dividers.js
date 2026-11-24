const G=require('../src/geometry.js');
function check(w,d,prm,label){
  const o=G.tileOutline(w,d,prm), m=G.prism(o,10);
  // manifold + volume
  const e=new Map(); let bad=0;
  for(let i=0;i<m.t.length;i+=3) for(let k=0;k<3;k++){const a=m.t[i+k],b=m.t[i+(k+1)%3];e.set(a+','+b,(e.get(a+','+b)||0)+1);}
  for(const [k,c] of e){const [a,b]=k.split(',');if(c!==1||!e.has(b+','+a))bad++;}
  let vol=0;for(let i=0;i<m.t.length;i+=3){const A=m.t[i]*3,B=m.t[i+1]*3,C=m.t[i+2]*3,V=m.v;
    vol+=V[A]*(V[B+1]*V[C+2]-V[B+2]*V[C+1])-V[A+1]*(V[B]*V[C+2]-V[B+2]*V[C])+V[A+2]*(V[B]*V[C+1]-V[B+1]*V[C]);}
  vol/=6; const area=G.polyArea(o);
  // self-intersection check on outline segments
  let x=0; const n=o.length;
  function inter(p1,p2,p3,p4){const d=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    return d(p1,p2,p3)*d(p1,p2,p4)<0&&d(p3,p4,p1)*d(p3,p4,p2)<0;}
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){if(i===0&&j===n-1)continue;if(inter(o[i],o[(i+1)%n],o[j],o[(j+1)%n]))x++;}
  console.log(label,'pts',n,'area',area.toFixed(2),'vol',vol.toFixed(1),'nonmanifold',bad,'selfX',x, Math.abs(vol-area*10)<1e-2*area?'volOK':'VOLBAD');
  return bad===0&&x===0&&Math.abs(vol-area*10)<1e-2*area;
}
let ok=true;
for (const [w,d] of [[1,1],[2,1],[2,2],[3,3],[4,2]]) for (const dir of ['y','x'])
  ok&=check(w,d,{divDir:dir,divEvery:5},w+'x'+d+' '+dir+' every5');
ok&=check(2,2,{divDir:'y',divEvery:25,divGap:0.2},'2x2 y every25');
console.log(JSON.stringify(G.dividerPositions(100,{divEvery:5})));
console.log(ok?'PASS':'FAIL'); process.exit(ok?0:1);
