// node test/engine.test.js
const assert = require('assert');
const Engine = require('../js/engine.js');
let ok = 0; const T = (n, f) => { f(); ok++; console.log('ok  ' + n); };

T('sumas por barra = total, delta y CVD exactos', () => {
  const e = new Engine({ type: 'time', size: 60000, group: 1 });
  let tot = 0, d = 0, t = 1e12;
  for (let i = 0; i < 5000; i++) {
    const q = 1 + (i % 7), s = (i * 7919) % 3 === 0 ? 1 : 0, p = 1000 + ((i * 31) % 40);
    e.add(t += 137, p, q, s); tot += q; d += s ? -q : q;
  }
  const sv = e.bars.reduce((a, b) => a + b.vol, 0), sd = e.bars.reduce((a, b) => a + b.buy - b.sell, 0);
  assert.strictEqual(sv, tot); assert.strictEqual(sd, d); assert.strictEqual(e.cvd, d);
  assert.strictEqual(e.bars[e.bars.length - 1].cvd, d);
  for (const b of e.bars) {
    let lv = 0; for (const x of b.lv.values()) lv += x[0] + x[1];
    assert.strictEqual(lv, b.vol);
    assert.strictEqual(b.t0 % 60000, 0);
  }
  let pv = 0; for (const x of e.prof.values()) pv += x[0] + x[1];
  assert.strictEqual(pv, tot);
});

T('POC, área de valor y desbalance diagonal apilado', () => {
  const e = new Engine({ type: 'time', size: 60000, group: 1, ratio: 3 });
  const t = 6e11;
  // bid en 100..103 = 10 ; ask en 101..104 = 40 (4x el bid de abajo) ; nivel 102 con más volumen
  for (let k = 100; k <= 103; k++) e.add(t + k, k, 10, 1);
  for (let k = 101; k <= 104; k++) e.add(t + k + 10, k, k === 102 ? 90 : 40, 0);
  const b = e.bars[0], s = e.stats(b);
  assert.strictEqual(e.bars.length, 1);
  assert.strictEqual(s.poc, 102);
  assert.ok(s.val <= 102 && s.vah >= 102);
  for (let k = 101; k <= 104; k++) assert.strictEqual(s.imb.get(k), 2, 'apilado comprador en ' + k);
  assert.strictEqual(s.imb.get(100), undefined);
});

T('agrupar precios y reconstruir con otro tipo de barra', () => {
  const e = new Engine({ type: 'time', size: 60000, group: 1 });
  for (let i = 0; i < 1000; i++) e.add(1e12 + i * 500, 2000 + (i % 23), 2, i % 2);
  e.set({ group: 10 });
  for (const b of e.bars) for (const k of b.lv.keys()) assert.strictEqual(k % 10, 0);
  e.set({ type: 'ticks', size: 100 });
  assert.strictEqual(e.bars.length, 10); assert.ok(e.bars.every(b => b.n === 100));
  e.set({ type: 'volume', size: 400 });
  assert.ok(e.bars.slice(0, -1).every(b => b.vol === 400));
  e.set({ type: 'range', size: 5 });
  assert.ok(e.bars.every(b => b.h - b.l <= 5));
  assert.strictEqual(e.bars.reduce((a, b) => a + b.vol, 0), 2000);
});

T('auditoría por minuto en enteros', () => {
  const e = new Engine({});
  for (let i = 0; i < 300; i++) e.add(1.2e12 + i * 100, 500, 0.001, i % 3 ? 0 : 1);
  const m = e.mins.get(1.2e12);
  assert.strictEqual(m.v, 300 * 1000); assert.strictEqual(m.b, 200 * 1000);
});
console.log(ok + ' pruebas pasaron');
