// Generates docs/*.png : UI screenshots (host simulated) + a shaded 3D render of the tiles.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'docs');
const geo = fs.readFileSync(path.join(root, 'src/geometry.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src/interfinity.html'), 'utf8').replace('/*__GEOMETRY__*/', geo);
const render = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#f4f5f7"><canvas id=c width=1600 height=900></canvas><script>${geo}
const G=window.Interfinity, cv=document.getElementById('c'), cx=cv.getContext('2d');
const items=[[3,3,{divDir:'y',divEvery:25},0,0,'#4a90d9'],[2,1,{},200,0,'#e5a13a'],[1,1,{},200,80,'#e5a13a'],[2,2,{divDir:'x',divEvery:25},0,200,'#3fae8c'],[4,1,{},180,200,'#c46a8f'],[3,2,{height:30},200,260,'#8a7fd0']];
const L=(()=>{const l=[-.5,-.7,.8],n=Math.hypot(...l);return l.map(x=>x/n)})();
const az=-0.6,el=0.62,ca=Math.cos(az),sa=Math.sin(az),ce=Math.cos(el),se=Math.sin(el);
function proj(x,y,z){const X=x*ca-y*sa,Y=x*sa+y*ca;return [X,-(Y*se+z*ce),Y*ce-z*se]}
const tris=[];
items.forEach(([w,d,p,ox,oy,col])=>{p.height=p.height||50;const m=G.tileMesh(w,d,p);const c=parseInt(col.slice(1),16),rgb=[c>>16&255,c>>8&255,c&255];
 for(let i=0;i<m.t.length;i+=3){const P=[0,1,2].map(k=>{const a=m.t[i+k]*3;return [m.v[a]+ox,m.v[a+1]+oy,m.v[a+2]]});
  const u=P[1].map((v,k)=>v-P[0][k]),v=P[2].map((q,k)=>q-P[0][k]);let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];const l=Math.hypot(...n)||1;n=n.map(x=>x/l);
  const sh=.4+.6*Math.max(0,n[0]*L[0]+n[1]*L[1]+n[2]*L[2]);
  tris.push({Q:P.map(q=>proj(...q)),c:rgb.map(x=>Math.round(x*sh))});}});
let mn=[1e9,1e9],mx=[-1e9,-1e9];tris.forEach(t=>t.Q.forEach(q=>{mn=[Math.min(mn[0],q[0]),Math.min(mn[1],q[1])];mx=[Math.max(mx[0],q[0]),Math.max(mx[1],q[1])]}));
const SS=2,W=cv.width*SS,H=cv.height*SS,s=Math.min((W-200)/(mx[0]-mn[0]),(H-200)/(mx[1]-mn[1]));
const zb=new Float32Array(W*H).fill(1e9),img=new Uint8ClampedArray(W*H*4);
for(let i=0;i<W*H;i++){img[i*4]=244;img[i*4+1]=245;img[i*4+2]=247;img[i*4+3]=255}
tris.forEach(t=>{const P=t.Q.map(q=>[100+(q[0]-mn[0])*s,100+(q[1]-mn[1])*s,q[2]]);
 const x0=Math.max(0,Math.floor(Math.min(P[0][0],P[1][0],P[2][0]))),x1=Math.min(W-1,Math.ceil(Math.max(P[0][0],P[1][0],P[2][0])));
 const y0=Math.max(0,Math.floor(Math.min(P[0][1],P[1][1],P[2][1]))),y1=Math.min(H-1,Math.ceil(Math.max(P[0][1],P[1][1],P[2][1])));
 const d=(P[1][1]-P[2][1])*(P[0][0]-P[2][0])+(P[2][0]-P[1][0])*(P[0][1]-P[2][1]);if(Math.abs(d)<1e-9)return;
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const a=((P[1][1]-P[2][1])*(x+.5-P[2][0])+(P[2][0]-P[1][0])*(y+.5-P[2][1]))/d,b=((P[2][1]-P[0][1])*(x+.5-P[2][0])+(P[0][0]-P[2][0])*(y+.5-P[2][1]))/d,c=1-a-b;
  if(a<-1e-6||b<-1e-6||c<-1e-6)continue;const z=a*P[0][2]+b*P[1][2]+c*P[2][2],k=y*W+x;if(z<zb[k]){zb[k]=z;img[k*4]=t.c[0];img[k*4+1]=t.c[1];img[k*4+2]=t.c[2];}}});
const big=document.createElement('canvas');big.width=W;big.height=H;big.getContext('2d').putImageData(new ImageData(img,W,H),0,0);
cx.imageSmoothingQuality='high';cx.drawImage(big,0,0,cv.width,cv.height);
</script>`;
(async () => {
  const b = await chromium.launch();
  const host = () => { window.orca = { postMessage(m){ if(m.type==='get_bed') setTimeout(()=>window.__cb&&window.__cb({type:'bed',x:256,y:256,printer:'Esempio 256×256'}),5); }, onMessage(f){window.__cb=f;} }; };
  async function shot(name, setup, size) {
    const pg = await b.newPage({ viewport: size || { width: 1200, height: 820 }, deviceScaleFactor: 2 });
    await pg.addInitScript(host);
    await pg.route('http://t.local/', r => r.fulfill({ contentType: 'text/html', body: ui }));
    await pg.goto('http://t.local/'); await pg.waitForTimeout(250);
    if (setup) await setup(pg);
    await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(out, name) }); await pg.close();
  }
  await shot('ui-lista.png');
  await shot('ui-divisori.png', async pg => {
    await pg.selectOption('#tileRows .tile-row:nth-child(1) select', 'y');
    await pg.fill('#tileRows .tile-row:nth-child(2) input:nth-of-type(4)', '30'); await pg.dispatchEvent('#tileRows .tile-row:nth-child(2) input:nth-of-type(4)', 'input');
    await pg.click('#presets button >> nth=2');
    await pg.selectOption('#tileRows .tile-row:nth-child(3) select', 'x');
  });
  await shot('ui-riempi-area.png', async pg => { await pg.click('#tabArea'); await pg.selectOption('#aDv', 'y'); });
  const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await pg.route('http://t.local/', r => r.fulfill({ contentType: 'text/html', body: render })); await pg.goto('http://t.local/'); await pg.waitForTimeout(500);
  await pg.locator('#c').screenshot({ path: path.join(out, 'render-tile.png') });
  await b.close();
})();
