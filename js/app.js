/* NORTHPOINT DEPTH · interfaz: footprint, heatmap de liquidez, libro, cinta y auditoría. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const QS = new URLSearchParams(location.search), DEMO = QS.get('demo') === '1';
  const ses = DEMO ? { name: 'demo', email: 'demo' } : NPAuth.session();
  if (!ses) { location.replace('login.html'); return; }
  if (DEMO) document.body.classList.add('demo');
  const MONO = '"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace';
  const C = { up: '#3ddc97', dn: '#ff5c70', ac: '#7aa2ff', tx: '#e8ecf3', mut: '#7c8696', line: 'rgba(255,255,255,.06)' };
  const up = a => `rgba(61,220,151,${a})`, dn = a => `rgba(255,92,112,${a})`;
  /* tick = tamaño real del tick · groups/hg/rng en ticks · qd = decimales de cantidad */
  let SY = [
    { id: 'BTCUSDT', tick: 0.1, dec: 1, qd: 3, groups: [10, 50, 100, 250, 500], g0: 100, hg: 10, volBar: 100, rng: 500, tape: [0.5, 1, 5, 10], minImb: 0.5, big: 5 },
    { id: 'ETHUSDT', tick: 0.01, dec: 2, qd: 3, groups: [10, 25, 50, 100, 200], g0: 50, hg: 10, volBar: 2000, rng: 300, tape: [10, 50, 100, 500], minImb: 5, big: 100 },
    { id: 'SOLUSDT', tick: 0.01, dec: 2, qd: 2, groups: [1, 2, 5, 10, 20], g0: 5, hg: 1, volBar: 20000, rng: 30, tape: [100, 500, 1000, 5000], minImb: 50, big: 1000 }
  ];
  SY[0].q0 = 0.1; SY[1].q0 = 1; SY[2].q0 = 10;
  /* Todos los perpetuos USDT de Binance: tick, filas, tamaño de trade grande, etc. salen del precio y del volumen real de 24 h */
  const nice = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return +((m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p).toPrecision(3); };
  const niceI = x => Math.max(1, Math.round(nice(Math.max(1, x))));
  const decs = s => { s = String(+s); if (s.includes('e-')) return +s.split('e-')[1]; const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
  async function loadSyms() {
    const [ei, tk] = await Promise.all(['exchangeInfo', 'ticker/24hr'].map(p => fetch('https://fapi.binance.com/fapi/v1/' + p).then(r => r.json())));
    const T = new Map(tk.map(t => [t.symbol, t])), out = [];
    for (const s of ei.symbols) {
      if (s.contractType !== 'PERPETUAL' || s.status !== 'TRADING' || s.quoteAsset !== 'USDT') continue;
      const t = T.get(s.symbol); if (!t || !(+t.lastPrice > 0) || !(+t.volume > 0)) continue;
      const pf = s.filters.find(f => f.filterType === 'PRICE_FILTER'), lf = s.filters.find(f => f.filterType === 'LOT_SIZE');
      const tick = +pf.tickSize, g0 = niceI(+t.lastPrice * 0.00015 / tick), m = +t.volume / 1440, big = nice(m / 20);
      out.push({ id: s.symbol, tick, dec: decs(pf.tickSize), qd: Math.min(3, decs(lf.stepSize)), g0,
        groups: [...new Set([0.1, 0.5, 1, 2.5, 5].map(k => Math.max(1, Math.round(g0 * k))))], hg: Math.max(1, Math.round(g0 / 10)),
        volBar: nice(m), rng: g0 * 5, tape: [nice(big / 10), nice(big / 4), big, nice(big * 2)], minImb: nice(m / 200), big,
        q0: Math.max(+lf.stepSize, nice(m / 1000)), qv: +t.quoteVolume });
    }
    out.sort((a, b) => b.qv - a.qv); if (out.length) SY = out.slice(0, 60);
  }
  const CK = 'npd.cfg.' + ses.email;
  const loadCfg = () => { try { return JSON.parse(localStorage.getItem(CK)) || {}; } catch (e) { return {}; } };
  const saveCfg = () => { if (DEMO) return; try { localStorage.setItem(CK, JSON.stringify({ sym: sym.id, bar: $('barSel').value, imb: $('imbSel').value, hist: $('histSel').value })); } catch (e) {} };
  /* eng = motor que se dibuja (en vivo o replay) · live = siempre el de en vivo */
  const geo = { ch: 0, cw: 0 }; let grab = null; // geometría del footprint y línea (sl/tp) que se está arrastrando
  let live, rep = null, bigs = [], sim = { pos: 0, avg: 0, real: 0, sl: null, tp: null };
  let sym = SY[0], eng, feed, view = 'fp', st = 'conectando', dirty = true, mouse = null;
  const v = { barW: 96, rowH: 16, offX: 0, cK: null, follow: true };
  const hv = { pps: 8, rowPx: 4, cK: null, follow: true, tR: 0, ref: 1 };
  const HR = 600, HMS = 500, HMAX = 4000;
  let heat = [], tape = [], cur = null, tapeMin = 1, domC = null;
  const stat = { cnt: 0, tps: 0, lat: 0 };
  let audit = { rows: [], ok: 0, n: 0 };
  /* diferencia entre el reloj de esta máquina y el del exchange, para medir latencia real */
  let skew = 0;
  (async () => { try { const a = Date.now(), j = await (await fetch('https://fapi.binance.com/fapi/v1/time')).json(), b = Date.now(); skew = (a + b) / 2 - j.serverTime; } catch (e) {} })();

  function fit(c) {
    const d = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); return x;
  }
  const fv = q => q >= 1e6 ? +(q / 1e6).toPrecision(3) + 'M' : q >= 10000 ? (q / 1000).toFixed(0) + 'k' : q >= 1000 ? (q / 1000).toFixed(1) + 'k'
    : q >= 100 ? q.toFixed(0) : q >= 10 ? q.toFixed(Math.min(1, sym.qd)) : q >= 1 ? q.toFixed(Math.min(2, sym.qd)) : q.toFixed(sym.qd);
  const fp = k => (k * sym.tick).toFixed(sym.dec);
  const p2 = n => (n < 10 ? '0' : '') + n;
  const ft = (t, s) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + (s ? ':' + p2(d.getSeconds()) : ''); };

  /* ---------- arranque / configuración ---------- */
  function barCfg() {
    const [type, sz] = $('barSel').value.split(':');
    return { type, size: sz === 'V' ? sym.volBar : sz === 'R' ? sym.rng : +sz, group: +$('grpSel').value, ratio: +$('imbSel').value, minImb: sym.minImb };
  }
  function fillSel() {
    $('grpSel').innerHTML = sym.groups.map(g => `<option value="${g}"${g === sym.g0 ? ' selected' : ''}>Fila ${(g * sym.tick).toFixed(sym.dec)}</option>`).join('');
    $('tapeMin').innerHTML = sym.tape.map((m, i) => `<option value="${m}"${i === 1 ? ' selected' : ''}>&ge; ${+m.toPrecision(3)}</option>`).join('');
    tapeMin = sym.tape[1]; $('simQ').value = sym.q0;
    const b = $('barSel'); b.options[6].text = 'Vol ' + fv(sym.volBar); b.options[7].text = 'Rango ' + (sym.rng * sym.tick).toFixed(sym.dec);
  }
  function start() {
    if (feed) feed.stop();
    heat = []; tape = []; cur = null; domC = null; v.cK = hv.cK = null; v.offX = 0; v.follow = hv.follow = true; hv.ref = 1;
    audit = { rows: [], ok: 0, n: 0 }; stat.lat = 0; st = 'conectando';
    live = eng = new Engine(barCfg()); rep = null; $('rp').style.display = 'none'; bigs = []; sim = { pos: 0, avg: 0, real: 0, sl: null, tp: null };
    feed = new BinanceFeed(sym, { trade: onTrade, status: s => { st = s; }, reset: () => { live.clear(); tape = []; bigs = []; } }, +$('histSel').value);
    feed.start(); dirty = true;
  }
  function onTrade(t, p, q, s, E) {
    live.add(t, p, q, s); stat.cnt++;
    if (!rep && sim.pos) bracket(p);
    if (E) { const l = Math.max(0, Date.now() - skew - E); stat.lat = stat.lat ? stat.lat * 0.9 + l * 0.1 : l; }
    if (cur && cur.t === t && cur.s === s) { cur.q += q; cur.pv += p * q; }
    else { if (cur) { if (cur.q >= tapeMin) { tape.unshift(cur); if (tape.length > 40) tape.pop(); } if (cur.q >= sym.big) { bigs.push(cur); if (bigs.length > 4000) bigs.shift(); } } cur = { t, s, q, pv: p * q }; }
    dirty = true;
  }

  /* ---------- foto del libro cada 500 ms para el heatmap ---------- */
  function snapHeat() {
    if (!feed || !feed.bookOk || live.last == null) return;
    const [bb, ba] = feed.best(); if (!isFinite(bb) || !isFinite(ba)) return;
    const hg = sym.hg, base = Math.floor((bb + ba) / 2 / hg) - HR / 2, a = new Float32Array(HR);
    for (const [k, q] of feed.bids) { const i = Math.floor(k / hg) - base; if (i >= 0 && i < HR) a[i] += q; }
    for (const [k, q] of feed.asks) { const i = Math.floor(k / hg) - base; if (i >= 0 && i < HR) a[i] += q; }
    heat.push({ t: feed.bookT, base, a, bb, ba }); if (heat.length > HMAX) heat.shift();
    const nz = Array.from(a).filter(x => x > 0).sort((x, y) => x - y);
    if (nz.length) { const r = nz[Math.floor(nz.length * 0.97)]; hv.ref = hv.ref === 1 ? r : hv.ref * 0.95 + r * 0.05; }
    dirty = true;
  }

  function hline(x, y, w, col, dash, label) {
    x.save(); x.strokeStyle = col; x.lineWidth = 1; x.setLineDash(dash || []); x.beginPath(); x.moveTo(0, Math.round(y) + 0.5); x.lineTo(w, Math.round(y) + 0.5); x.stroke();
    if (label) { x.fillStyle = col; x.font = '9px ' + MONO; x.textAlign = 'left'; x.fillText(label, 4, y - 6); }
    x.restore();
  }
  function tag(x, cw, y, txt, bg, fg) {
    x.fillStyle = bg; x.fillRect(cw, y - 8, 68, 16); x.fillStyle = fg || '#05070a'; x.font = '11px ' + MONO; x.textAlign = 'left'; x.fillText(txt, cw + 6, y + 0.5);
  }

  /* ---------- FOOTPRINT ---------- */
  function drawFP() {
    const c = $('fp'), x = fit(c), W = c.clientWidth, H = c.clientHeight; x.clearRect(0, 0, W, H);
    const AX = 68, TB = 18, ST = 92, PR = 118, ch = H - TB - ST, cw = W - AX, g = eng.o.group, bars = eng.bars, nb = bars.length;
    x.textBaseline = 'middle'; x.font = '11px ' + MONO;
    if (!nb) { x.fillStyle = C.mut; x.textAlign = 'center'; x.fillText('Esperando trades…', W / 2, H / 2); return; }
    const last = bars[nb - 1];
    if (v.cK == null) v.cK = last.c;
    const Y = p => ch / 2 - (p - v.cK) / g * v.rowH;
    if (v.follow) { const yl = Y(last.c); if (yl < ch * 0.18 || yl > ch * 0.82) v.cK = last.c; }
    const xR = cw - PR, X = i => xR - (nb - i) * v.barW + v.offX;
    const kTop = v.cK + ch / 2 / v.rowH * g, kBot = v.cK - ch / 2 / v.rowH * g, stepK = g * Math.ceil(24 / v.rowH);

    x.save(); x.beginPath(); x.rect(0, 0, cw, ch); x.clip();
    x.fillStyle = C.line;
    for (let k = Math.ceil(kBot / stepK) * stepK; k <= kTop; k += stepK) x.fillRect(0, Math.round(Y(k)), cw, 1);
    /* perfil de volumen de todo lo cargado */
    const h1 = Math.max(1, v.rowH - 1);
    for (const [k, e] of eng.prof) {
      const yT = Y(k + g); if (yT > ch || yT + v.rowH < 0) continue;
      const tot = e[0] + e[1], w = tot / eng.pmax * (PR - 14), ws = w * e[0] / tot;
      x.fillStyle = dn(0.38); x.fillRect(xR + 8, yT, ws, h1); x.fillStyle = up(0.38); x.fillRect(xR + 8 + ws, yT, w - ws, h1);
    }
    const ps = eng.profStats();
    if (ps) {
      hline(x, Y(ps.vah + g), cw, 'rgba(255,255,255,.22)', [2, 4], 'VAH');
      hline(x, Y(ps.val), cw, 'rgba(255,255,255,.22)', [2, 4], 'VAL');
      hline(x, Y(ps.poc) - v.rowH / 2, cw, 'rgba(122,162,255,.55)', [6, 4], 'POC');
      hline(x, Y(ps.vwap + 0.5), cw, 'rgba(232,236,243,.5)', [1, 3], 'VWAP');
    }
    const num = v.barW >= 64 && v.rowH >= 11, cells = v.barW >= 18, vis = [];
    const fs = Math.max(9, Math.min(11, v.rowH - 4));
    for (let i = nb - 1; i >= 0; i--) {
      const bx = X(i); if (bx >= xR) continue; if (bx + v.barW < 0) break;
      vis.push(i);
      const b = bars[i], s = eng.stats(b), cwd = cells ? 3 : Math.max(1, v.barW - 2), cx = bx + (cells ? 3 : 1);
      x.fillStyle = b.c >= b.o ? C.up : C.dn;
      const yh = Y(b.h + 0.5), yl = Y(b.l + 0.5), yo = Y(b.o + 0.5), yc = Y(b.c + 0.5);
      x.fillRect(cx + cwd / 2 - 0.5, yh, 1, Math.max(1, yl - yh)); x.fillRect(cx, Math.min(yo, yc), cwd, Math.max(1, Math.abs(yc - yo)));
      if (!cells) continue;
      const x0 = bx + 9, w = v.barW - 11, mid = x0 + w / 2;
      for (const [k, e] of b.lv) {
        const yT = Y(k + g); if (yT > ch || yT + v.rowH < 0) continue;
        const im = s.imb.get(k) || 0;
        if (num) {
          const a = Math.min(0.4, 0.05 + (e[0] + e[1]) / s.mx * 0.35);
          x.fillStyle = e[1] >= e[0] ? up(a) : dn(a); x.fillRect(x0, yT, w, h1);
          const ty = yT + h1 / 2 + 0.5;
          x.textAlign = 'right'; x.font = (im < 0 ? '700 ' : '') + fs + 'px ' + MONO; x.fillStyle = im < 0 ? '#ff97a4' : 'rgba(232,236,243,.7)'; x.fillText(fv(e[0]), mid - 5, ty);
          x.textAlign = 'left'; x.font = (im > 0 ? '700 ' : '') + fs + 'px ' + MONO; x.fillStyle = im > 0 ? '#86f3c2' : 'rgba(232,236,243,.7)'; x.fillText(fv(e[1]), mid + 5, ty);
          x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(mid, yT + 2, 1, h1 - 4);
          if (im === 2 || im === -2) { x.fillStyle = im > 0 ? C.up : C.dn; x.fillRect(im > 0 ? x0 + w - 2 : x0, yT, 2, h1); }
        } else {
          x.fillStyle = dn(Math.min(0.9, e[0] / s.mxs)); x.fillRect(x0, yT, w / 2, h1);
          x.fillStyle = up(Math.min(0.9, e[1] / s.mxs)); x.fillRect(mid, yT, w / 2, h1);
        }
        if (k === s.poc) { x.strokeStyle = C.ac; x.lineWidth = 1; x.strokeRect(x0 + 0.5, yT + 0.5, w - 1, h1 - 1); }
      }
      x.fillStyle = 'rgba(255,255,255,.28)'; x.fillRect(bx + 7, Y(s.vah + g), 1, Y(s.val) - Y(s.vah + g));
    }
    /* trades grandes: un círculo por cada orden agresora de tamaño institucional */
    if (cells && vis.length) {
      const tMin = bars[vis[vis.length - 1]].t0, tMax = eng.lastT;
      for (let j = bigs.length - 1; j >= 0; j--) {
        const b = bigs[j]; if (b.t > tMax) continue; if (b.t < tMin) break;
        let a = 0, z = nb - 1; while (a < z) { const m = (a + z + 1) >> 1; if (bars[m].t0 <= b.t) a = m; else z = m - 1; }
        const r = Math.max(4, Math.min(v.barW * 0.42, Math.sqrt(b.q / sym.big) * 6));
        x.beginPath(); x.arc(X(a) + v.barW / 2 + 4, Y(b.pv / b.q + 0.5), r, 0, 6.2832);
        x.fillStyle = b.s ? dn(0.16) : up(0.16); x.fill(); x.strokeStyle = b.s ? C.dn : C.up; x.lineWidth = 1.25; x.stroke();
      }
    }
    if (sim.pos) hline(x, Y(sim.avg + 0.5), cw, C.ac, [], 'ENTRADA ' + (sim.pos > 0 ? '+' : '') + +sim.pos.toFixed(4));
    geo.ch = ch; geo.cw = cw;
    if (sim.pos) for (const [k, col, nm] of [['sl', C.dn, 'STOP'], ['tp', C.up, 'OBJETIVO']]) if (sim[k] != null) {
      const pl = (sim[k] - sim.avg) * sym.tick * sim.pos;
      hline(x, Y(sim[k] + 0.5), cw, col, [5, 3], nm + ' ' + fp(sim[k]) + '   ' + (pl >= 0 ? '+' : '') + pl.toFixed(2) + (grab === k ? '' : '   arrastra para mover'));
    }
    x.restore();

    /* eje de precio */
    x.font = '11px ' + MONO; x.textAlign = 'left'; x.fillStyle = C.mut;
    for (let k = Math.ceil(kBot / stepK) * stepK; k <= kTop; k += stepK) { const y = Y(k) - v.rowH / 2; if (y > 6 && y < ch - 6) x.fillText(fp(k), cw + 6, y); }
    const yl = Y(eng.last + 0.5); if (yl > 0 && yl < ch) tag(x, cw, yl, fp(eng.last), eng.lastS ? C.dn : C.up);

    /* tira: delta por barra, CVD, volumen */
    x.fillStyle = C.line; x.fillRect(0, ch, W, 1); x.fillRect(cw, 0, 1, H - TB);
    const dh = ST - 30, zy = ch + 2 + dh / 2;
    let md = 1e-9, c0 = Infinity, c1 = -Infinity;
    for (const i of vis) { const b = bars[i]; md = Math.max(md, Math.abs(b.buy - b.sell)); c0 = Math.min(c0, b.cvd); c1 = Math.max(c1, b.cvd); }
    x.save(); x.beginPath(); x.rect(0, ch, cw, ST + TB); x.clip();
    x.fillStyle = C.line; x.fillRect(0, zy, cw, 1);
    const stepL = Math.ceil(72 / v.barW);
    for (const i of vis) {
      const b = bars[i], bx = X(i), d = b.buy - b.sell, hh = Math.max(1, Math.abs(d) / md * (dh / 2 - 3));
      x.fillStyle = d >= 0 ? up(0.75) : dn(0.75); x.fillRect(bx + 3, d >= 0 ? zy - hh : zy, Math.max(1, v.barW - 6), hh);
      x.textAlign = 'center'; x.font = '10px ' + MONO;
      if (v.barW >= 46) {
        x.fillStyle = d >= 0 ? C.up : C.dn; x.fillText((d >= 0 ? '+' : '-') + fv(Math.abs(d)), bx + v.barW / 2, ch + dh + 9);
        x.fillStyle = C.mut; x.fillText(fv(b.vol), bx + v.barW / 2, ch + dh + 22);
      }
      if (i % stepL === 0) { x.fillStyle = C.mut; x.fillText(ft(b.t0, eng.o.type !== 'time' || eng.o.size < 60000), bx + v.barW / 2, H - TB / 2); }
    }
    x.strokeStyle = C.ac; x.lineWidth = 1.5; x.beginPath();
    for (let j = vis.length - 1; j >= 0; j--) {
      const b = bars[vis[j]], px = X(vis[j]) + v.barW / 2, py = ch + 5 + (c1 - b.cvd) / ((c1 - c0) || 1) * (dh - 8);
      j === vis.length - 1 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.stroke(); x.restore();
    x.textAlign = 'left'; x.font = '9px ' + MONO; x.fillStyle = C.ac; x.fillText('CVD ' + (eng.cvd >= 0 ? '+' : '-') + fv(Math.abs(eng.cvd)), cw + 6, ch + 12);
    x.fillStyle = C.mut; x.fillText('DELTA', cw + 6, ch + dh + 9); x.fillText('VOL', cw + 6, ch + dh + 22);

    /* cursor y lectura */
    let rb = last;
    if (mouse && mouse.v === 'fp' && mouse.x < cw && mouse.y < ch) {
      x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(0, mouse.y, cw, 1); x.fillRect(mouse.x, 0, 1, H - TB);
      tag(x, cw, mouse.y, fp(Math.floor(v.cK + (ch / 2 - mouse.y) / v.rowH * g)), '#1a2230', C.tx);
      const i = nb - Math.ceil((xR + v.offX - mouse.x) / v.barW); if (i >= 0 && i < nb) rb = bars[i];
    }
    const s = eng.stats(rb), d = rb.buy - rb.sell;
    $('read').innerHTML = `<b>${sym.id}</b> ${ft(rb.t0, 1)} &nbsp; A <b>${fp(rb.o)}</b> M <b>${fp(rb.h)}</b> m <b>${fp(rb.l)}</b> C <b>${fp(rb.c)}</b> &nbsp; Vol <b>${fv(rb.vol)}</b> &nbsp; Delta <b class="${d >= 0 ? 'u' : 'd'}">${d >= 0 ? '+' : '-'}${fv(Math.abs(d))}</b> &nbsp; POC <b>${fp(s.poc)}</b> &nbsp; Trades <b>${rb.n}</b>`;
  }

  /* ---------- HEATMAP DE LIQUIDEZ ---------- */
  const LUT = new Uint32Array(256);
  (function () {
    const S = [[0, 10, 18, 40], [0.35, 26, 58, 150], [0.72, 122, 162, 255], [1, 255, 255, 255]];
    for (let u = 0; u < 256; u++) {
      const t = Math.pow(u / 255, 0.65); let i = 0; while (i < S.length - 2 && t > S[i + 1][0]) i++;
      const a = S[i], b = S[i + 1], f = (t - a[0]) / (b[0] - a[0]);
      const r = a[1] + (b[1] - a[1]) * f, g = a[2] + (b[2] - a[2]) * f, bl = a[3] + (b[3] - a[3]) * f, al = Math.min(255, 40 + t * 330);
      LUT[u] = ((al << 24) | (bl << 16) | (g << 8) | r) >>> 0;
    }
  })();
  let off, img, rowOf;
  function drawHM() {
    const c = $('hm'), x = fit(c), W = c.clientWidth, H = c.clientHeight; x.clearRect(0, 0, W, H);
    const AX = 68, TB = 18, NP = 74, ch = H - TB, cw = W - AX, hg = sym.hg;
    x.textBaseline = 'middle'; x.font = '11px ' + MONO;
    if (!heat.length || eng.last == null) { x.fillStyle = C.mut; x.textAlign = 'center'; x.fillText('Sincronizando libro…', W / 2, H / 2); return; }
    const lt = rep ? heat[j0(eng.lastT)] : heat[heat.length - 1];
    if (hv.follow) hv.tR = rep ? eng.lastT : Math.max(lt.t, eng.lastT || 0);
    if (hv.cK == null) hv.cK = eng.last;
    const Y = p => ch / 2 - (p - hv.cK) / hg * hv.rowPx;
    if (hv.follow) { const yl = Y(eng.last); if (yl < ch * 0.2 || yl > ch * 0.8) hv.cK = eng.last; }
    const xN = cw - NP, Xt = t => xN - (hv.tR - t) / 1000 * hv.pps, tL = hv.tR - xN / hv.pps * 1000;
    const iw = Math.max(1, xN | 0), ih = Math.max(1, ch | 0);
    if (!off || off.width !== iw || off.height !== ih) { off = document.createElement('canvas'); off.width = iw; off.height = ih; img = off.getContext('2d').createImageData(iw, ih); rowOf = new Int32Array(ih); }
    for (let y = 0; y < ih; y++) rowOf[y] = Math.floor((hv.cK + (ch / 2 - y - 0.5) / hv.rowPx * hg) / hg);
    const d = new Uint32Array(img.data.buffer); d.fill(0);
    const sc = 255 / (hv.ref * 1.6) * +$('con').value;
    let j = 0; { let a = 0, b = heat.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (heat[m].t <= tL) a = m; else b = m - 1; } j = a; }
    for (let px = 0; px < iw; px++) {
      const t = hv.tR - (xN - px - 0.5) / hv.pps * 1000;
      while (j + 1 < heat.length && heat[j + 1].t <= t) j++;
      const col = heat[j]; if (col.t > t || t - col.t > 3000) continue;
      const a = col.a, b = col.base;
      for (let y = 0; y < ih; y++) {
        const q = a[rowOf[y] - b];
        if (q > 0) { let u = (q * sc) | 0; if (u > 255) u = 255; d[y * iw + px] = LUT[u]; }
      }
    }
    off.getContext('2d').putImageData(img, 0, 0); x.drawImage(off, 0, 0, iw, ih);

    x.save(); x.beginPath(); x.rect(0, 0, xN, ch); x.clip();
    /* mejor bid / ask en el tiempo */
    for (const side of [0, 1]) {
      x.strokeStyle = side ? dn(0.75) : up(0.75); x.lineWidth = 1; x.beginPath(); let f = 1;
      for (let i = j0(tL); i < heat.length; i++) {
        const col = heat[i], px = Xt(col.t), py = Y((side ? col.ba : col.bb) + 0.5);
        if (f) { x.moveTo(px, py); f = 0; } else { x.lineTo(px, py); }
      }
      x.stroke();
    }
    /* trades agresores como burbujas (tamaño = volumen) */
    const bms = Math.max(100, 2500 / hv.pps); let key = -1, ac = [null, null];
    const flush = () => {
      for (const a of ac) {
        if (!a || a.q < sym.big * 0.03) continue;
        const r = Math.max(1.5, Math.min(30, Math.sqrt(a.q / sym.big) * 9));
        x.beginPath(); x.arc(Xt(a.t), Y(a.pv / a.q + 0.5), r, 0, 6.2832);
        x.fillStyle = a.s ? dn(0.5) : up(0.5); x.fill(); x.strokeStyle = a.s ? C.dn : C.up; x.lineWidth = 1; x.stroke();
      }
      ac = [null, null];
    };
    for (let i = eng.seek(tL); i < eng.n; i++) {
      const t = eng.T[i]; if (t > hv.tR) break;
      const k = Math.floor(t / bms); if (k !== key) { flush(); key = k; }
      const s = eng.S[i]; let a = ac[s]; if (!a) a = ac[s] = { t, q: 0, pv: 0, s };
      a.q += eng.Q[i]; a.pv += eng.P[i] * eng.Q[i];
    }
    flush(); x.restore();

    /* libro actual a la derecha */
    x.fillStyle = C.line; x.fillRect(xN, 0, 1, ch); x.fillRect(cw, 0, 1, ch); x.fillRect(0, ch, W, 1);
    let mq = 1e-9; const r0 = Math.floor((hv.cK - ch / 2 / hv.rowPx * hg) / hg), r1 = Math.floor((hv.cK + ch / 2 / hv.rowPx * hg) / hg);
    for (let r = r0; r <= r1; r++) { const q = lt.a[r - lt.base]; if (q > mq) mq = q; }
    for (let r = r0; r <= r1; r++) {
      const q = lt.a[r - lt.base]; if (!(q > 0)) continue;
      x.fillStyle = r * hg <= lt.bb ? up(0.55) : dn(0.55); x.fillRect(xN + 3, Y((r + 1) * hg), q / mq * (NP - 8), Math.max(1, hv.rowPx - 0.5));
    }
    /* ejes */
    const stepK = hg * Math.ceil(24 / hv.rowPx), kT = hv.cK + ch / 2 / hv.rowPx * hg, kB = hv.cK - ch / 2 / hv.rowPx * hg;
    x.fillStyle = C.mut; x.textAlign = 'left';
    for (let k = Math.ceil(kB / stepK) * stepK; k <= kT; k += stepK) { const y = Y(k + hg / 2); if (y > 6 && y < ch - 6) x.fillText(fp(k), cw + 6, y); }
    const yl = Y(eng.last + 0.5); if (yl > 0 && yl < ch) tag(x, cw, yl, fp(eng.last), eng.lastS ? C.dn : C.up);
    const stepS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => s * hv.pps >= 80) || 600;
    x.textAlign = 'center'; x.fillStyle = C.mut;
    for (let t = Math.ceil(tL / (stepS * 1000)) * stepS * 1000; t <= hv.tR; t += stepS * 1000) x.fillText(ft(t, 1), Xt(t), H - TB / 2);

    let txt = `<b>${sym.id}</b> liquidez en reposo · fila ${(hg * sym.tick).toFixed(sym.dec)} · foto cada ${HMS} ms · ${heat.length} columnas`;
    if (mouse && mouse.v === 'hm' && mouse.x < xN && mouse.y < ch) {
      x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(0, mouse.y, cw, 1); x.fillRect(mouse.x, 0, 1, ch);
      const p = Math.floor(hv.cK + (ch / 2 - mouse.y) / hv.rowPx * hg), t = hv.tR - (xN - mouse.x) / hv.pps * 1000;
      tag(x, cw, mouse.y, fp(p), '#1a2230', C.tx);
      let i = j0(t); const col = heat[i], q = col && col.t <= t ? col.a[Math.floor(p / hg) - col.base] || 0 : 0;
      txt = `<b>${sym.id}</b> ${ft(t, 1)} &nbsp; precio <b>${fp(Math.floor(p / hg) * hg)}</b> &nbsp; liquidez <b>${fv(q)}</b>`;
    }
    $('read').innerHTML = txt;
  }
  function j0(t) { let a = 0, b = heat.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (heat[m].t <= t) a = m; else b = m - 1; } return a; }

  /* ---------- LIBRO (DOM) + CINTA + ESTADO ---------- */
  function drawDOM() {
    const c = $('dom'), x = fit(c), W = c.clientWidth, H = c.clientHeight; x.clearRect(0, 0, W, H);
    if (rep) { x.fillStyle = C.mut; x.font = '11px ' + MONO; x.textAlign = 'center'; x.fillText('Replay: el libro solo existe en vivo', W / 2, 30); return; }
    if (!feed || !feed.bookOk || eng.last == null) return;
    const g = eng.o.group, rh = 17, rows = Math.floor(H / rh), B = new Map(), A = new Map();
    for (const [k, q] of feed.bids) { const r = Math.floor(k / g) * g; B.set(r, (B.get(r) || 0) + q); }
    for (const [k, q] of feed.asks) { const r = Math.floor(k / g) * g; A.set(r, (A.get(r) || 0) + q); }
    const lk = Math.floor(eng.last / g) * g;
    if (domC == null || domC % g || Math.abs(lk - domC) / g > rows * 0.3) domC = lk;
    const top = domC + Math.floor(rows / 2) * g, pw = Math.round(W * 0.18), PC = 74, cwd = (W - pw - PC) / 2, xb = pw, xp = pw + cwd, xa = xp + PC;
    let mq = 1e-9, mp = 1e-9;
    for (let r = 0; r < rows; r++) { const k = top - r * g; mq = Math.max(mq, B.get(k) || 0, A.get(k) || 0); const e = eng.prof.get(k); if (e) mp = Math.max(mp, e[0] + e[1]); }
    x.textBaseline = 'middle'; x.font = '11px ' + MONO;
    for (let r = 0; r < rows; r++) {
      const k = top - r * g, y = r * rh, b = B.get(k) || 0, a = A.get(k) || 0, e = eng.prof.get(k);
      if (e) { const w = (e[0] + e[1]) / mp * (pw - 6), ws = w * e[0] / (e[0] + e[1]); x.fillStyle = dn(0.4); x.fillRect(2, y + 2, ws, rh - 4); x.fillStyle = up(0.4); x.fillRect(2 + ws, y + 2, w - ws, rh - 4); }
      if (b) { const w = b / mq * (cwd - 4); x.fillStyle = up(0.2); x.fillRect(xp - w, y + 1, w, rh - 2); x.fillStyle = C.up; x.textAlign = 'right'; x.fillText(fv(b), xp - 5, y + rh / 2); }
      if (a) { const w = a / mq * (cwd - 4); x.fillStyle = dn(0.2); x.fillRect(xa, y + 1, w, rh - 2); x.fillStyle = C.dn; x.textAlign = 'left'; x.fillText(fv(a), xa + 5, y + rh / 2); }
      if (k === lk) { x.fillStyle = 'rgba(122,162,255,.2)'; x.fillRect(xp, y, PC, rh); }
      x.fillStyle = k === lk ? C.tx : C.mut; x.textAlign = 'center'; x.fillText(fp(k), xp + PC / 2, y + rh / 2);
    }
    const [bb, ba] = feed.best(); $('spr').textContent = 'spread ' + ((ba - bb) * sym.tick).toFixed(sym.dec);
  }
  function slow() {
    if (!live) return;
    drawDOM();
    $('tape').innerHTML = tape.slice(0, 13).map(t => `<div class="r ${t.s ? 'd' : 'u'}"><span style="color:var(--mut)">${ft(t.t, 1)}</span><span>${fp(Math.round(t.pv / t.q))}</span><span>${fv(t.q)}</span></div>`).join('');
    const pl = sim.pos ? (eng.last - sim.avg) * sym.tick * sim.pos : 0, sg = n => (n >= 0 ? '+' : '') + n.toFixed(2);
    $('sPos').textContent = sim.pos ? (sim.pos > 0 ? '+' : '') + +sim.pos.toFixed(4) : '0'; $('sAvg').textContent = sim.pos ? (sim.avg * sym.tick).toFixed(sym.dec) : '-';
    $('sSL').textContent = sim.sl != null ? fp(sim.sl) : '-'; $('sTP').textContent = sim.tp != null ? fp(sim.tp) : '-';
    $('sOpen').textContent = sg(pl); $('sOpen').className = pl >= 0 ? 'u' : 'd'; $('sReal').textContent = sg(sim.real); $('sReal').className = sim.real >= 0 ? 'u' : 'd';
    const isLive = st === 'en vivo' && feed && feed.bookOk, e = $('st');
    e.className = 'chip ' + (isLive ? 'ok' : st === 'reconectando' ? 'bad' : '');
    e.innerHTML = `<i></i>${isLive ? 'EN VIVO' : st} · ${Math.round(stat.lat)} ms · ${stat.tps}/s · ${live.n.toLocaleString('es-MX')} trades` +
      (feed && (feed.gaps || feed.resyncs) ? ` · ${feed.gaps} huecos recuperados · ${feed.resyncs} resync` : '') + (feed && feed.lost ? ` · ${feed.lost} PERDIDOS` : '');
  }

  /* ---------- AUDITORÍA contra la vela oficial del exchange ---------- */
  async function runAudit() {
    if (!feed || !feed.ready || live.firstT == null) return;
    const f = feed; let kl; try { kl = await f.klines(15); } catch (e) { return; }
    if (f !== feed) return;
    const now = Math.max(f.bookT || 0, live.lastT || 0), rows = [];
    for (const k of kl) {
      /* el primer minuto cargado no se audita: su borde con el minuto anterior no se puede comprobar */
      if (k.t + 60000 + 3000 > now || k.t < Math.ceil(live.firstT / 60000) * 60000 + 60000) continue;
      const m = live.mins.get(k.t) || { v: 0, b: 0 };
      rows.push({ t: k.t, v: m.v, b: m.b, ov: k.v, ob: k.b, ok: m.v === k.v && m.b === k.b });
    }
    /* un trade agregado que cruza el cambio de minuto: lo que le sobra a un minuto le falta al siguiente (no se perdió nada) */
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i], b = rows[i + 1];
      if (!a.ok && !b.ok && !a.edge && a.v - a.ov + b.v - b.ov === 0 && a.b - a.ob + b.b - b.ob === 0) a.edge = b.edge = true;
    }
    const good = rows.filter(r => r.ok || r.edge).length, ed = rows.filter(r => r.edge).length;
    audit = { rows, n: rows.length, ok: good };
    const e = $('aud');
    e.className = 'chip ' + (!rows.length ? '' : good === audit.n ? 'ok' : 'bad');
    e.innerHTML = `<i></i>` + (rows.length ? `Auditoría ${good}/${audit.n} min sin pérdida` + (ed ? ` · ${ed / 2} cruce` : '') : 'Auditoría: esperando 1er minuto');
    if ($('audP').style.display === 'block') showAudit();
  }
  function showAudit() {
    const u = n => (n / 1e6).toFixed(3);
    $('audP').innerHTML = `<h4>Auditoría de precisión</h4><p>Cada minuto cerrado comparo MI suma de trades contra la vela oficial del exchange: volumen total y volumen de compra agresora (de ahí sale el delta). Si coincide al milésimo, no se perdió ni un trade.</p>
      <table><tr><th>Minuto</th><th>Mi vol</th><th>Oficial</th><th>Mi compra</th><th>Oficial</th><th></th></tr>` +
      audit.rows.slice().reverse().map(r => `<tr><td>${ft(r.t)}</td><td>${u(r.v)}</td><td>${u(r.ov)}</td><td>${u(r.b)}</td><td>${u(r.ob)}</td><td class="${r.ok || r.edge ? 'u' : 'd'}">${r.ok ? 'exacto' : r.edge ? 'cruce ' + u(r.v - r.ov) : 'dif ' + u(r.v - r.ov)}</td></tr>`).join('') +
      `</table>` + (audit.rows.length ? '' : '<p>Aún no cierra el primer minuto completo.</p>');
  }

  /* ---------- eventos ---------- */
  function wire(id, name) {
    const c = $(id); let drag = null;
    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect(); mouse = { v: name, x: e.clientX - r.left, y: e.clientY - r.top };
      if (name === 'fp') {
        if (grab) { sim[grab] = Math.round(v.cK + (geo.ch / 2 - mouse.y) / v.rowH * eng.o.group - 0.5); dirty = true; return; }
        c.style.cursor = hit(mouse) ? 'ns-resize' : '';
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
        if (name === 'fp') { v.offX += dx; v.cK += dy / v.rowH * eng.o.group; v.follow = false; }
        else { hv.tR -= dx / hv.pps * 1000; hv.cK += dy / hv.rowPx * sym.hg; hv.follow = false; }
        $('fol').style.borderColor = C.ac;
      }
      dirty = true;
    });
    c.addEventListener('mousedown', e => { if (name === 'fp' && mouse && (grab = hit(mouse))) return; drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mouseup', () => { drag = null; grab = null; dirty = true; });
    c.addEventListener('mouseleave', () => { mouse = null; dirty = true; });
    c.addEventListener('dblclick', follow);
    c.addEventListener('wheel', e => {
      e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 1 / 1.1, onAxis = e.shiftKey || e.ctrlKey || (mouse && mouse.x > c.clientWidth - 68);
      if (name === 'fp') { if (onAxis) v.rowH = Math.max(2, Math.min(40, v.rowH * f)); else v.barW = Math.max(3, Math.min(260, v.barW * f)); }
      else { if (onAxis) hv.rowPx = Math.max(1, Math.min(24, hv.rowPx * f)); else hv.pps = Math.max(0.5, Math.min(80, hv.pps * f)); }
      dirty = true;
    }, { passive: false });
  }
  function hit(m) { // ¿el cursor está sobre la línea de stop u objetivo?
    if (!sim.pos || m.x > geo.cw || m.y > geo.ch) return null;
    for (const k of ['sl', 'tp']) if (sim[k] != null && Math.abs(geo.ch / 2 - (sim[k] + 0.5 - v.cK) / eng.o.group * v.rowH - m.y) < 6) return k;
    return null;
  }
  function follow() { v.follow = hv.follow = true; v.offX = 0; v.cK = hv.cK = eng.last; $('fol').style.borderColor = ''; dirty = true; }

  $('symSel').onchange = e => { sym = SY.find(s => s.id === e.target.value); fillSel(); saveCfg(); start(); };
  $('histSel').onchange = () => { saveCfg(); start(); };
  for (const id of ['barSel', 'grpSel', 'imbSel']) $(id).onchange = () => { saveCfg(); live.set(barCfg()); if (rep) rep.eng.set(barCfg()); v.offX = 0; domC = null; dirty = true; };
  $('tapeMin').onchange = e => { tapeMin = +e.target.value; tape = []; };
  $('con').oninput = () => { dirty = true; };
  $('fol').onclick = follow;
  function setView(nv) {
    view = nv === 'hm' ? 'hm' : 'fp';
    for (const q of $('tabs').children) q.classList.toggle('on', q.dataset.v === view);
    $('fp').style.display = view === 'fp' ? '' : 'none'; $('hm').style.display = view === 'hm' ? '' : 'none';
    $('conW').style.display = view === 'hm' ? '' : 'none'; dirty = true;
  }
  $('tabs').onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); };
  window.addEventListener('message', e => { if (e.data && e.data.np === 'view') setView(e.data.v); });
  $('aud').onclick = () => { const p = $('audP'); $('trkP').style.display = 'none'; p.style.display = p.style.display === 'block' ? 'none' : 'block'; showAudit(); };

  /* ---------- REPLAY: vuelve a pasar los trades guardados, tick por tick ---------- */
  function repAdd(to, quiet) { const r = rep; while (r.i < to) { r.eng.add(r.T[r.i], r.P[r.i], r.Q[r.i], r.S[r.i]); if (!quiet && sim.pos) bracket(r.P[r.i]); r.i++; } }
  function repSeek(f) { const r = rep; r.eng.clear(); r.i = 0; repAdd(Math.max(1, Math.floor(r.n * f)), true); r.t = r.T[r.i - 1]; follow(); }
  function repStart() {
    if (rep || live.n < 100) return; const n = live.n;
    rep = { T: live.T.slice(0, n), P: live.P.slice(0, n), Q: live.Q.slice(0, n), S: live.S.slice(0, n), n, i: 0, t: 0, play: true, eng: new Engine(barCfg()) };
    eng = rep.eng; $('rp').style.display = 'flex'; $('rpP').textContent = 'Pausa'; repSeek(0.5);
  }
  function repStop() { if (!rep) return; rep = null; eng = live; $('rp').style.display = 'none'; follow(); }
  function repTick(dt) {
    const r = rep; if (!r) return;
    if (r.play) {
      r.t += Math.min(dt, 200) * +$('rpS').value; let to = r.i; while (to < r.n && r.T[to] <= r.t) to++;
      if (to > r.i) { repAdd(to); dirty = true; }
      if (r.i >= r.n) { r.play = false; $('rpP').textContent = 'Reproducir'; }
      $('rpR').value = Math.round(r.i / r.n * 1000);
    }
    $('rpT').textContent = ft(r.t, 1) + ' · trade ' + r.i.toLocaleString('es-MX') + ' de ' + r.n.toLocaleString('es-MX');
  }
  $('rpB').onclick = repStart; $('rpX').onclick = repStop;
  $('rpP').onclick = () => { if (!rep) return; if (!rep.play && rep.i >= rep.n) repSeek(0); rep.play = !rep.play; $('rpP').textContent = rep.play ? 'Pausa' : 'Reproducir'; };
  $('rpR').oninput = e => { if (rep) repSeek(+e.target.value / 1000); };

  /* ---------- TERMINAL SIMULADA + historial automático (ninguna orden sale al mercado) ---------- */
  const TK = 'npd.trades.' + ses.email; let trk = [];
  try { trk = JSON.parse(localStorage.getItem(TK)) || []; } catch (e) {}
  /* stop = orden de mercado al tocarse (se llena al precio del trade que lo tocó, con su deslizamiento);
     objetivo = orden límite (se llena a su precio) */
  function bracket(p) {
    if (!sim.pos) return; const s = Math.sign(sim.pos), q = Math.abs(sim.pos);
    if (sim.sl != null && (s > 0 ? p <= sim.sl : p >= sim.sl)) simOrder(-s, q, p, 'stop');
    else if (sim.tp != null && (s > 0 ? p >= sim.tp : p <= sim.tp)) simOrder(-s, q, sim.tp, 'objetivo');
  }
  function simOrder(side, q, fpx, tag) {
    if (!(q > 0) || eng.last == null) return; let px = eng.last;
    if (!rep && feed.bookOk) { const [bb, ba] = feed.best(); px = side > 0 ? ba : bb; } // en vivo: compra al ask, vende al bid
    if (fpx != null) px = fpx;
    let rem = q; const ps = Math.sign(sim.pos);
    if (ps && ps !== side) {
      const c = Math.min(Math.abs(sim.pos), rem), pnl = (px - sim.avg) * sym.tick * c * ps; sim.real += pnl;
      trk.unshift({ t: Date.now(), sym: sym.id, side: ps, q: c, a: sim.avg * sym.tick, b: px * sym.tick, pnl, rep: !!rep, tag: tag || '' }); trk = trk.slice(0, 200);
      if (!DEMO) try { localStorage.setItem(TK, JSON.stringify(trk)); } catch (e) {}
      sim.pos = +(sim.pos + side * c).toFixed(8); rem -= c; if (!sim.pos) sim.avg = 0;
    }
    if (rem > 1e-9) { const np = +(sim.pos + side * rem).toFixed(8); sim.avg = (Math.abs(sim.pos) * sim.avg + rem * px) / Math.abs(np); sim.pos = np; }
    /* al abrir o voltear posición: stop a 8 filas y objetivo a 16 (2R); luego se arrastran */
    if (!sim.pos) sim.sl = sim.tp = null;
    else if (ps !== Math.sign(sim.pos)) { const d = eng.o.group * 8 * Math.sign(sim.pos); sim.sl = Math.round(sim.avg) - d; sim.tp = Math.round(sim.avg) + 2 * d; }
    dirty = true; if ($('trkP').style.display === 'block') showTrk();
  }
  function showTrk() {
    const tot = trk.reduce((a, t) => a + t.pnl, 0), w = trk.filter(t => t.pnl > 0).length;
    $('trkP').innerHTML = `<h4>Historial automático</h4><p>Cada operación simulada queda registrada sola. Nada de esto sale al mercado.<br>${trk.length} operaciones · aciertos ${trk.length ? Math.round(w / trk.length * 100) : 0}% · P/L total <b class="${tot >= 0 ? 'u' : 'd'}">${tot >= 0 ? '+' : ''}${tot.toFixed(2)}</b></p>
      <table><tr><th>Hora</th><th>Símbolo</th><th>Lado</th><th>Cant.</th><th>Entrada</th><th>Salida</th><th>P/L</th></tr>` +
      trk.slice(0, 14).map(t => `<tr><td>${ft(t.t, 1)}${t.rep ? ' R' : ''}</td><td>${t.sym}</td><td class="${t.side > 0 ? 'u' : 'd'}">${t.side > 0 ? 'Largo' : 'Corto'}${t.tag ? ' · ' + t.tag : ''}</td><td>${+t.q.toFixed(4)}</td><td>${+t.a.toFixed(4)}</td><td>${+t.b.toFixed(4)}</td><td class="${t.pnl >= 0 ? 'u' : 'd'}">${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</td></tr>`).join('') + '</table>';
  }
  $('buy').onclick = () => simOrder(1, +$('simQ').value); $('sell').onclick = () => simOrder(-1, +$('simQ').value);
  $('flat').onclick = () => { if (sim.pos) simOrder(-Math.sign(sim.pos), Math.abs(sim.pos)); };
  $('sSL').onclick = () => { sim.sl = null; dirty = true; }; $('sTP').onclick = () => { sim.tp = null; dirty = true; };
  $('trkB').onclick = () => { const p = $('trkP'); $('audP').style.display = 'none'; p.style.display = p.style.display === 'block' ? 'none' : 'block'; showTrk(); };
  $('usr').textContent = ses.name.split(' ')[0] + ' · Salir';
  $('usr').onclick = () => { NPAuth.logout(); location.href = 'index.html'; };
  wire('fp', 'fp'); wire('hm', 'hm');
  window.addEventListener('resize', () => { dirty = true; });

  (async () => {
    try { await loadSyms(); } catch (e) {}
    const cfg = loadCfg(), want = QS.get('s') || cfg.sym;
    $('symSel').innerHTML = SY.map(s => `<option>${s.id}</option>`).join('');
    sym = SY.find(s => s.id === want) || SY.find(s => s.id === 'BTCUSDT') || SY[0]; $('symSel').value = sym.id; fillSel();
    for (const [id, k] of [['barSel', 'bar'], ['imbSel', 'imb'], ['histSel', 'hist']]) if (cfg[k] && [...$(id).options].some(o => o.value === cfg[k])) $(id).value = cfg[k];
    start(); if (QS.get('v')) setView(QS.get('v'));
  })();
  setInterval(snapHeat, HMS);
  setInterval(slow, 200);
  setInterval(() => { stat.tps = stat.cnt; stat.cnt = 0; }, 1000);
  setInterval(runAudit, 15000); setTimeout(runAudit, 6000);
  let pt = performance.now();
  (function loop() { const nt = performance.now(); repTick(nt - pt); pt = nt; if (dirty && eng) { dirty = false; try { view === 'fp' ? drawFP() : drawHM(); } catch (e) { console.error(e); } } requestAnimationFrame(loop); })();
  window.__np = { get eng() { return eng; }, get live() { return live; }, get sim() { return sim; }, get feed() { return feed; }, get audit() { return audit; }, get heat() { return heat; } };
})();
