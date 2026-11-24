const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src');
const html = fs.readFileSync(path.join(src,'interfinity.html'),'utf8').replace('/*__GEOMETRY__*/', fs.readFileSync(path.join(src,'geometry.js'),'utf8'));
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({viewport:{width:1100,height:760}, deviceScaleFactor:1});
  const errs=[]; pg.on('pageerror',e=>errs.push(e.message)); pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await pg.addInitScript(() => {
    window.__sent=[]; window.__file={chunks:[]}; let cb=null;
    window.orca = { postMessage(m){ window.__sent.push(m.type);
        const r=x=>setTimeout(()=>cb&&cb(x),5);
        if(m.type==='get_bed') r({type:'bed',x:256,y:256,printer:'Test',settings:null});
        if(m.type==='save_file_start'){window.__file={name:m.name,total:m.total_bytes,place:m.place,chunks:[]};r({type:'chunk_ack',index:-1});}
        if(m.type==='save_file_chunk'){window.__file.chunks.push(m.chunk);r({type:'chunk_ack',index:m.index});}
        if(m.type==='save_file_finish'){r({type:'saved',path:'/x/'+window.__file.name,pending:true});setTimeout(()=>cb({type:'placed',placed:true,path:'/x/'+window.__file.name}),20);}
      }, onMessage(f){cb=f;} };
  });
  await pg.route('http://t.local/', r=>r.fulfill({contentType:'text/html',body:html})); await pg.goto('http://t.local/'); await pg.waitForTimeout(200);
  console.log('summary:', await pg.textContent('#summary'));
  await pg.screenshot({path: process.argv[2]+'/ui_list.png'});
  await pg.selectOption('#tileRows .tile-row:nth-child(1) select','y');
  await pg.fill('#tileRows .tile-row:nth-child(2) input:nth-of-type(4)','30'); await pg.dispatchEvent('#tileRows .tile-row:nth-child(2) input:nth-of-type(4)','input');
  await pg.fill('#dE','5'); await pg.dispatchEvent('#dE','input'); await pg.waitForTimeout(150);
  console.log('summary2:', await pg.textContent('#summary'));
  await pg.screenshot({path: process.argv[2]+'/ui_div.png'});
  await pg.click('text=Invia a OrcaSlicer >> nth=0'); await pg.waitForTimeout(500);
  const f = await pg.evaluate(()=>window.__file);
  const bytes = Buffer.from(f.chunks.join(''),'base64'); const tri = bytes.readUInt32LE(80);
  console.log('sent', f.name, 'bytes', bytes.length, 'declared', f.total, 'tris', tri, 'sizeOK', bytes.length===84+tri*50, 'place', f.place);
  console.log('status:', await pg.textContent('#status'));
  // area mode
  await pg.click('#tabArea'); await pg.waitForTimeout(100);
  console.log('area:', await pg.textContent('#areaInfo'));
  await pg.screenshot({path: process.argv[2]+'/ui_area.png'});
  // oversize
  await pg.fill('#bX','120'); await pg.dispatchEvent('#bX','input'); await pg.waitForTimeout(100);
  console.log('oversize summary:', await pg.textContent('#summary'));
  console.log('errors:', JSON.stringify(errs));
  await b.close(); fs.writeFileSync(process.argv[2]+'/last.stl', bytes);
})();
