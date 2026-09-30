/* パーティクル演出（加算合成のグロースプライトを Canvas に描画）。
   座標は #content の設計座標（1600x900）。キャンバスは上下に余白 OFF を持つ。 */
const FX = (function () {
  'use strict';
  const CW = 1600, CHT = 1200, OFF = 150;
  let cv, ctx, raf = 0, last = 0, ambient = 0, ambAcc = 0;
  let parts = [], rings = [];
  const sprites = {};
  const COLORS = { gold: [255, 205, 96], white: [255, 246, 220], silver: [214, 226, 240], red: [255, 80, 70] };

  function sprite(name) {
    if (sprites[name]) return sprites[name];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const [r, g, b] = COLORS[name];
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, `rgba(${r},${g},${b},.95)`);
    gr.addColorStop(0.5, `rgba(${r},${g},${b},.28)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return (sprites[name] = c);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function kick() {
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }

  /* 中心から放射状に弾ける */
  function burst(x, y, n, o) {
    o = o || {};
    const cols = o.colors || ['gold', 'gold', 'white'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(o.min || 150, o.max || 900);
      parts.push({ t: 0, life: rnd(0.6, o.life || 1.5), x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 0), g: o.grav === undefined ? 520 : o.grav, drag: 1.8, size: rnd(6, o.size || 22), c: pick(cols), tw: Math.random() * 6 });
    }
    kick();
  }
  /* 外周から一点へ光が集まる */
  function converge(x, y, n, dur) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(420, 900);
      parts.push({ conv: true, t: -rnd(0, dur * 0.55), life: dur * rnd(0.4, 0.55), sx: x + Math.cos(a) * r, sy: y + Math.sin(a) * r * 0.7, tx: x, ty: y, x: 0, y: 0, size: rnd(8, 24), c: pick(['gold', 'white', 'gold']), tw: 0 });
    }
    kick();
  }
  /* 上から金粉が降る */
  function rain(n, dur, cols) {
    for (let i = 0; i < n; i++) {
      parts.push({ t: -rnd(0, dur), life: rnd(1.6, 2.6), x: rnd(0, CW), y: -OFF - 20, vx: rnd(-40, 40), vy: rnd(260, 560), g: 120, drag: 0.2, size: rnd(6, 18), c: pick(cols || ['gold', 'gold', 'white']), tw: Math.random() * 6 });
    }
    kick();
  }
  function ring(x, y, color, maxR, dur) {
    rings.push({ x, y, t: 0, dur: dur || 0.7, maxR: maxR || 900, c: COLORS[color || 'gold'] });
    kick();
  }
  /* 常時ただよう光の粒。rate は 1秒あたりの発生数（0で停止）。 */
  function setAmbient(rate, colors) {
    ambient = rate;
    setAmbient.colors = colors || ['gold'];
    if (rate > 0) kick();
  }
  function clear() { parts = []; rings = []; }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (ambient > 0) {
      ambAcc += ambient * dt;
      while (ambAcc >= 1) {
        ambAcc -= 1;
        parts.push({ t: 0, life: rnd(3, 6), x: rnd(0, CW), y: rnd(200, 1050) , vx: rnd(-12, 12), vy: rnd(-46, -14), g: 0, drag: 0, size: rnd(4, 12), c: pick(setAmbient.colors), tw: Math.random() * 6, amb: true });
      }
    }
    ctx.clearRect(0, 0, CW, CHT);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t < 0) continue;
      const u = p.t / p.life;
      if (u >= 1) { parts.splice(i, 1); continue; }
      let alpha, size = p.size;
      if (p.conv) {
        const e = u * u * u; // 吸い込まれるほど加速
        p.x = p.sx + (p.tx - p.sx) * e;
        p.y = p.sy + (p.ty - p.sy) * e;
        alpha = Math.min(1, u * 3);
        size = p.size * (1.2 - u * 0.6);
      } else {
        p.vx -= p.vx * p.drag * dt;
        p.vy += (p.g - p.vy * p.drag) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        alpha = p.amb ? Math.sin(u * Math.PI) * 0.6 : 1 - u * u;
        alpha *= 0.75 + 0.25 * Math.sin(p.t * 14 + p.tw); // きらめき
      }
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.drawImage(sprite(p.c), p.x - size, p.y + OFF - size, size * 2, size * 2);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      const u = r.t / r.dur;
      if (u >= 1) { rings.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - u, 3);
      ctx.globalAlpha = (1 - u) * 0.9;
      ctx.lineWidth = 26 * (1 - u) + 2;
      ctx.strokeStyle = `rgb(${r.c[0]},${r.c[1]},${r.c[2]})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y + OFF, r.maxR * e, r.maxR * e * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (parts.length || rings.length || ambient > 0) raf = requestAnimationFrame(loop);
    else { raf = 0; ctx.clearRect(0, 0, CW, CHT); }
  }

  function init(canvas) {
    cv = canvas;
    cv.width = CW; cv.height = CHT;
    ctx = cv.getContext('2d');
  }

  return { init, burst, converge, rain, ring, setAmbient, clear };
})();
