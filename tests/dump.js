const G=require('../src/geometry.js');
const out={};
for (const [w,d] of [[1,1],[2,1],[2,2],[2,3],[4,1],[3,3],[4,2],[3,2]]) {
  const m=G.tileMesh(w,d,{});
  out[w+'x'+d]={v:Array.from(m.v),t:Array.from(m.t)};
}
const old=G.tileMesh(1,1,{clearance:0.4});out['1x1_cl04']={v:Array.from(old.v),t:Array.from(old.t)};
require('fs').writeFileSync(process.argv[2],JSON.stringify(out));
