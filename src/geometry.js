/* Interfinity geometry engine (no dependencies; runs in the plugin page and in node).
 *
 * A tile is a straight prism (extruded along Z) whose outline is a W x D
 * rectangle with half-round features on its edges:
 *   - bottom and left edges : sockets (notches), radius = knobR + clearance
 *   - top and right edges   : knobs (bumps),     radius = knobR
 * Features are centred ON the edge, one every `spacing` mm, the first at
 * spacing/2 from the corner. Measured from the original Interfinity meshes:
 * pitch 50, spacing 25, knob R 3, socket R 3.5 (R + CL), height 50.
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    pitch: 50,        // one grid unit, mm
    height: 50,       // prism height (Z), mm
    knobR: 3,         // R
    clearance: 0.5,   // CL  (socket radius = R + CL)
    spacing: 25,      // distance between consecutive knobs/sockets
    seg: 24,          // segments per half circle
    divDir: "none",   // internal dividers: "none" | "y" (walls run along Y) | "x" (along X)
    divEvery: 25,     // divider spacing, multiple of the 5 mm module
    divGap: 0.2,      // slit width: the two vase-mode lines that form the divider
    divPassage: 10    // opening left at the free end of each divider
  };
  var MODULE = 5;

  function params(p) {
    var o = {};
    for (var k in DEFAULTS) {
      if (k === "divDir") o[k] = (p && p[k]) || DEFAULTS[k];
      else o[k] = (p && p[k] != null) ? +p[k] : DEFAULTS[k];
    }
    o.seg = Math.max(4, Math.round(o.seg));
    return o;
  }

  function featureCount(len, spacing) { return Math.max(1, Math.round(len / spacing)); }

  /* Divider positions along a straight edge of length len. Positions are
   * multiples of `every` (itself a multiple of the 5 mm module) and are skipped
   * where they would run into a knob/socket. Returns {pos:[...], skipped:[...]} */
  function dividerPositions(len, prm) {
    var p = params(prm), every = Math.max(MODULE, Math.round(p.divEvery / MODULE) * MODULE);
    var rs = p.knobR + p.clearance, off = p.spacing / 2, nf = featureCount(len, p.spacing);
    var pos = [], skipped = [];
    for (var x = every; x <= len - MODULE + 1e-9; x += every) {
      var bad = false;
      for (var k = 0; k < nf; k++) if (Math.abs(x - (off + k * p.spacing)) < rs + p.divGap / 2 + 1.0) bad = true;
      (bad ? skipped : pos).push(x);
    }
    return { pos: pos, skipped: skipped };
  }

  function outlineBase(w, d, p, slits) {
    var W = w * p.pitch, D = d * p.pitch;
    var rk = p.knobR, rs = p.knobR + p.clearance, n = p.seg, off = p.spacing / 2;
    var nx = featureCount(W, p.spacing), ny = featureCount(D, p.spacing);
    var pts = [[0, 0]], i, k, t, g = p.divGap / 2;
    function arc(cx, cy, r, a0, a1) {
      for (i = 0; i <= n; i++) {
        t = a0 + (a1 - a0) * i / n;
        pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
      }
    }
    var L = D - p.divPassage;
    var bottom = [], top = [];
    for (k = 0; k < nx; k++) bottom.push({ x: off + k * p.spacing, f: "arc" });
    for (k = 0; k < nx; k++) top.push({ x: off + k * p.spacing, f: "arc" });
    slits.forEach(function (x, idx) { (idx % 2 ? top : bottom).push({ x: x, f: "slit" }); });
    bottom.sort(function (a, b) { return a.x - b.x; });
    top.sort(function (a, b) { return b.x - a.x; });
    // bottom edge, left -> right : sockets bulge into +y; slits go up from y=0
    bottom.forEach(function (e) {
      if (e.f === "arc") arc(e.x, 0, rs, Math.PI, 0);
      else pts.push([e.x - g, 0], [e.x - g, L], [e.x + g, L], [e.x + g, 0]);
    });
    pts.push([W, 0]);
    // right edge, bottom -> top : knobs bulge +x
    for (k = 0; k < ny; k++) arc(W, off + k * p.spacing, rk, -Math.PI / 2, Math.PI / 2);
    pts.push([W, D]);
    // top edge, right -> left : knobs bulge +y; slits go down from y=D
    top.forEach(function (e) {
      if (e.f === "arc") arc(e.x, D, rk, 0, Math.PI);
      else pts.push([e.x + g, D], [e.x + g, D - L], [e.x - g, D - L], [e.x - g, D]);
    });
    pts.push([0, D]);
    // left edge, top -> bottom : sockets bulge into +x
    for (k = ny - 1; k >= 0; k--) arc(0, off + k * p.spacing, rs, Math.PI / 2, -Math.PI / 2);
    return pts;
  }

  /* Counter-clockwise outline of a w x d (units) tile, core rectangle at
   * [0,W] x [0,D]; knobs stick out to W+R and D+R. Returns [[x,y],...].
   * With dividers the outline is still ONE closed loop (so it prints in vase
   * mode): each divider is a thin slit cut in from the edge, alternating
   * sides to leave a serpentine passage. */
  function tileOutline(w, d, prm) {
    var p = params(prm);
    if (p.divDir === "none" || (p.divDir === "y" ? d : w) * p.pitch - p.divPassage < 5) return outlineBase(w, d, p, []);
    if (p.divDir === "y") return outlineBase(w, d, p, dividerPositions(w * p.pitch, p).pos);
    // dividers along X: build the transposed tile (d wide, w deep) and swap axes
    var t = outlineBase(d, w, p, dividerPositions(d * p.pitch, p).pos);
    return t.map(function (q) { return [q[1], q[0]]; }).reverse();
  }

  function polyArea(P) {
    var a = 0;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1];
    return a / 2;
  }

  /* Ear-clipping triangulation of a simple CCW polygon -> [[i,j,k],...] */
  function triangulate(P) {
    var n = P.length, idx = [], i, tris = [];
    for (i = 0; i < n; i++) idx.push(i);
    function cross(a, b, c) {
      return (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
    }
    function inTri(a, b, c, q) {
      var d1 = cross(a, b, q), d2 = cross(b, c, q), d3 = cross(c, a, q);
      return d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12;
    }
    var guard = n * n + 10;
    while (idx.length > 3 && guard-- > 0) {
      var m = idx.length, clipped = false, best = -1, bestArea = -1;
      for (i = 0; i < m; i++) {
        var a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
        var cr = cross(a, b, c);
        if (cr <= 1e-12) continue;                       // reflex or flat
        var ok = true;
        for (var j = 0; j < m; j++) {
          var q = idx[j];
          if (q === a || q === b || q === c) continue;
          if (inTri(a, b, c, q)) { ok = false; break; }
        }
        if (!ok) continue;
        // prefer fat ears (keeps triangles well shaped)
        if (cr > bestArea) { bestArea = cr; best = i; }
        if (cr > 1e-3) { best = i; break; }
      }
      if (best < 0) throw new Error("triangulation failed");
      i = best;
      tris.push([idx[(i + m - 1) % m], idx[i], idx[(i + 1) % m]]);
      idx.splice(i, 1);
      clipped = true;
    }
    tris.push([idx[0], idx[1], idx[2]]);
    return tris;
  }

  /* Prism mesh from an outline, base at z=0, top at z=h.
   * Returns {v: Float32Array(3n), t: Uint32Array(3m)} */
  function prism(outline, h) {
    var P = outline.slice();
    if (polyArea(P) < 0) P.reverse();
    var n = P.length, tris = triangulate(P);
    var v = new Float32Array(n * 6), i;
    for (i = 0; i < n; i++) {
      v[i * 3] = P[i][0]; v[i * 3 + 1] = P[i][1]; v[i * 3 + 2] = 0;
      v[(n + i) * 3] = P[i][0]; v[(n + i) * 3 + 1] = P[i][1]; v[(n + i) * 3 + 2] = h;
    }
    var t = [];
    tris.forEach(function (tr) {
      t.push(tr[0] + n, tr[1] + n, tr[2] + n);   // top, facing +z
      t.push(tr[0], tr[2], tr[1]);               // bottom, facing -z
    });
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      t.push(i, j, j + n);
      t.push(i, j + n, i + n);
    }
    return { v: v, t: new Uint32Array(t) };
  }

  function tileMesh(w, d, prm) {
    var p = params(prm);
    return prism(tileOutline(w, d, p), p.height);
  }

  /* Merge several meshes, each translated by (dx,dy). items:[{mesh,dx,dy}] */
  function merge(items) {
    var nv = 0, nt = 0;
    items.forEach(function (it) { nv += it.mesh.v.length; nt += it.mesh.t.length; });
    var v = new Float32Array(nv), t = new Uint32Array(nt), vo = 0, to = 0;
    items.forEach(function (it) {
      var base = vo / 3, m = it.mesh, i;
      for (i = 0; i < m.v.length; i += 3) {
        v[vo + i] = m.v[i] + (it.dx || 0);
        v[vo + i + 1] = m.v[i + 1] + (it.dy || 0);
        v[vo + i + 2] = m.v[i + 2];
      }
      for (i = 0; i < m.t.length; i++) t[to + i] = m.t[i] + base;
      vo += m.v.length; to += m.t.length;
    });
    return { v: v, t: t };
  }

  /* Binary STL (Uint8Array). Re-centres XY on the bounding box when centre=true. */
  function toSTL(mesh, centre) {
    var nT = mesh.t.length / 3, buf = new ArrayBuffer(84 + nT * 50), dv = new DataView(buf);
    var ox = 0, oy = 0, i;
    if (centre) {
      var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
      for (i = 0; i < mesh.v.length; i += 3) {
        mnx = Math.min(mnx, mesh.v[i]); mxx = Math.max(mxx, mesh.v[i]);
        mny = Math.min(mny, mesh.v[i + 1]); mxy = Math.max(mxy, mesh.v[i + 1]);
      }
      ox = (mnx + mxx) / 2; oy = (mny + mxy) / 2;
    }
    var hdr = "Interfinity", c;
    for (i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
    dv.setUint32(80, nT, true);
    var o = 84;
    for (i = 0; i < nT; i++) {
      var a = mesh.t[i * 3] * 3, b = mesh.t[i * 3 + 1] * 3, cc = mesh.t[i * 3 + 2] * 3, V = mesh.v;
      var ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
      var wx = V[cc] - V[a], wy = V[cc + 1] - V[a + 1], wz = V[cc + 2] - V[a + 2];
      var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      o += 12;
      [a, b, cc].forEach(function (q) {
        dv.setFloat32(o, V[q] - ox, true); dv.setFloat32(o + 4, V[q + 1] - oy, true); dv.setFloat32(o + 8, V[q + 2], true);
        o += 12;
      });
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Uint8Array(buf);
  }

  /* Footprint of a tile including its knobs: [0, W+R] x [0, D+R] */
  function footprint(w, d, prm) {
    var p = params(prm);
    return { w: w * p.pitch + p.knobR, d: d * p.pitch + p.knobR };
  }

  /* Shelf-pack tiles onto plates.
   * tiles: [{w,d,label}] (already expanded by quantity)
   * bed: {x,y}; margin from the edge, gap between tiles.
   * Returns { plates:[ [{tile,x,y}] ], oversize:[tile] }  (x,y = lower-left of footprint, bed coords) */
  function pack(tiles, bed, prm, margin, gap) {
    var items = tiles.map(function (t, i) { var f = footprint(t.w, t.d, prm); return { tile: t, w: f.w, d: f.d, i: i }; });
    items.sort(function (a, b) { return b.d - a.d || b.w - a.w || a.i - b.i; });
    var usableX = bed.x - 2 * margin, usableY = bed.y - 2 * margin;
    var plates = [], oversize = [];
    function newPlate() { var p = { items: [], shelves: [] }; plates.push(p); return p; }
    items.forEach(function (it) {
      if (it.w > usableX + 1e-9 || it.d > usableY + 1e-9) { oversize.push(it.tile); return; }
      for (var pi = 0; pi <= plates.length; pi++) {
        var plate = plates[pi] || newPlate(), placed = false, s;
        for (s = 0; s < plate.shelves.length && !placed; s++) {
          var sh = plate.shelves[s];
          if (it.d <= sh.d + 1e-9 && sh.x + it.w <= usableX + 1e-9) {
            plate.items.push({ tile: it.tile, x: margin + sh.x, y: margin + sh.y });
            sh.x += it.w + gap; placed = true;
          }
        }
        if (!placed) {
          var y = plate.shelves.length ? plate.shelves[plate.shelves.length - 1].y + plate.shelves[plate.shelves.length - 1].d + gap : 0;
          if (y + it.d <= usableY + 1e-9) {
            plate.shelves.push({ y: y, d: it.d, x: it.w + gap });
            plate.items.push({ tile: it.tile, x: margin, y: margin + y });
            placed = true;
          }
        }
        if (placed) break;
      }
    });
    return { plates: plates.map(function (p) { return p.items; }), oversize: oversize };
  }

  /* Split an A x B unit area into tiles no bigger than maxW x maxD. Row/column
   * chunks are staggered by `stagger` units on odd rows when asked, to avoid
   * 4-way seams. Returns [{w,d,col,row}] in assembly order with unit offsets. */
  function splitArea(A, B, maxW, maxD, stagger) {
    var out = [], y = 0, row = 0;
    var rows = chunks(B, maxD);
    rows.forEach(function (dd) {
      var x = 0, widths = chunks(A, maxW);
      if (stagger && row % 2 === 1 && widths.length > 1) widths = shiftChunks(widths);
      widths.forEach(function (ww) { out.push({ w: ww, d: dd, x: x, y: y }); x += ww; });
      y += dd; row++;
    });
    return out;
  }
  function chunks(total, max) {
    var n = Math.ceil(total / max), base = Math.floor(total / n), rem = total - base * n, r = [];
    for (var i = 0; i < n; i++) r.push(base + (i < rem ? 1 : 0));
    return r;
  }
  function shiftChunks(a) { return a.slice(1).concat(a.slice(0, 1)); }

  var api = {
    DEFAULTS: DEFAULTS, params: params, tileOutline: tileOutline, polyArea: polyArea,
    triangulate: triangulate, prism: prism, tileMesh: tileMesh, merge: merge, toSTL: toSTL,
    footprint: footprint, pack: pack, dividerPositions: dividerPositions, splitArea: splitArea
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Interfinity = api;
})(typeof window !== "undefined" ? window : this);
