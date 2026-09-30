/* リール描画とスピン運動。
   位置 p（セル単位）は区間ごとの速度曲線を解析的に積分して求めるので、フレームレートに
   依存せず必ず目標セルの中心で止まる。停止直前は「手前の絵柄で止まりかけ → もう1コマ
   倒れ込む → デテントにバネで収まる」という動きになる。 */
const Reel = (function () {
  'use strict';
  const W = 720, H = 440, CH = 220, SW = 680, S = 2; // 設計px。S はキャンバス解像度倍率
  const BLUR_S = 0.5, PAD = 80;
  const STRIPS = {
    1: [500, 'NEXT', 0, 1000],
    2: [1000, 'NEXT', 0, 3000, 2000, 5000],
    3: [10000, 100000, 0, 50000],
  };
  const NUM_FONT = '"Bodoni 72","Bodoni 72 Oldstyle","Didot","Bodoni MT","Times New Roman",serif';
  const LBL_FONT = '"Copperplate","Copperplate Gothic Bold","Cinzel","Trajan Pro","Times New Roman",serif';
  const PAL = {
    gold: { grad: ['#fff8d6', '#f6d571', '#c8922e', '#8f5f14', '#e9c25e', '#fff1b8'], ext: '#3b2505', edge: '#1a0f02', hi: 'rgba(255,250,220,.75)', glow: null },
    rich: { grad: ['#ffffff', '#ffe68a', '#e0a62f', '#9a6510', '#ffd76a', '#fff8d8'], ext: '#4a2c04', edge: '#1a0f02', hi: 'rgba(255,255,240,.9)', glow: 'rgba(255,200,80,.55)' },
    silver: { grad: ['#ffffff', '#d5dbe2', '#8d97a4', '#4c545f', '#b7c0ca', '#f4f7fa'], ext: '#1d2126', edge: '#08090b', hi: 'rgba(255,255,255,.7)', glow: null },
    next: { grad: ['#ffffff', '#fff3c0', '#f0c04c', '#b37a18', '#ffe9a0', '#ffffff'], ext: '#4a2c04', edge: '#140b01', hi: 'rgba(255,255,255,.95)', glow: 'rgba(255,225,140,.7)' },
  };

  let cv, ctx, stage = 1, strip = STRIPS[1], pos = 0, raf = 0;
  const imgs = {};

  const mod = (a, n) => ((a % n) + n) % n;
  const fmt = (v) => Number(v).toLocaleString('en-US');

  function metalText(c, text, cx, cy, px, font, pal, maxW) {
    c.font = '700 ' + px + 'px ' + font;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    let w = c.measureText(text).width;
    if (w > maxW) { px = Math.floor(px * maxW / w); c.font = '700 ' + px + 'px ' + font; }
    const m = c.measureText(text);
    const asc = m.actualBoundingBoxAscent || px * 0.7, desc = m.actualBoundingBoxDescent || 0;
    const y = cy + (asc - desc) / 2; // 実際の字面で上下中央に合わせる
    const depth = Math.max(3, Math.round(px * 0.045));
    c.lineJoin = 'round';
    if (pal.glow) { c.save(); c.shadowColor = pal.glow; c.shadowBlur = px * 0.22; c.fillStyle = pal.glow; c.fillText(text, cx, y); c.restore(); }
    // 影 → 押し出し（立体感）→ 縁 → 金属グラデーション → ハイライト
    c.save(); c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = 14; c.shadowOffsetY = depth + 6; c.fillStyle = pal.edge; c.fillText(text, cx, y + depth); c.restore();
    c.lineWidth = px * 0.075; c.strokeStyle = pal.edge;
    for (let i = depth; i > 0; i--) { c.strokeText(text, cx, y + i); }
    c.fillStyle = pal.ext;
    for (let i = depth; i > 0; i--) c.fillText(text, cx, y + i);
    c.strokeText(text, cx, y);
    const g = c.createLinearGradient(0, y - asc, 0, y + desc);
    g.addColorStop(0, pal.grad[0]); g.addColorStop(0.28, pal.grad[1]); g.addColorStop(0.5, pal.grad[2]);
    g.addColorStop(0.53, pal.grad[3]); g.addColorStop(0.72, pal.grad[4]); g.addColorStop(1, pal.grad[5]);
    c.fillStyle = g; c.fillText(text, cx, y);
    c.lineWidth = 1.5; c.strokeStyle = pal.hi; c.strokeText(text, cx, y - 1);
  }

  function chevrons(c, cx, cy, dir, pal) {
    for (let i = 0; i < 3; i++) {
      const x = cx + dir * i * 26;
      c.beginPath();
      c.moveTo(x - dir * 12, cy - 34); c.lineTo(x + dir * 12, cy); c.lineTo(x - dir * 12, cy + 34);
      c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = pal.edge; c.stroke();
      c.lineWidth = 5; c.strokeStyle = pal.grad[i === 2 ? 0 : 1]; c.globalAlpha = 0.45 + i * 0.27; c.stroke();
      c.globalAlpha = 1;
    }
  }

  function renderSharp(sym) {
    const c = document.createElement('canvas');
    c.width = SW * S; c.height = CH * S;
    const x = c.getContext('2d');
    x.scale(S, S);
    if (sym === 'NEXT') {
      metalText(x, 'NEXT', SW / 2, CH / 2 - 44, 92, LBL_FONT, PAL.next, 420);
      metalText(x, 'STAGE', SW / 2, CH / 2 + 46, 92, LBL_FONT, PAL.next, 420);
      chevrons(x, 66, CH / 2, 1, PAL.next);
      chevrons(x, SW - 66, CH / 2, -1, PAL.next);
    } else {
      const pal = sym === 0 ? PAL.silver : sym >= 10000 ? PAL.rich : PAL.gold;
      metalText(x, fmt(sym), SW / 2, CH / 2, 178, NUM_FONT, pal, 600);
    }
    return c;
  }
  // 縦方向のモーションブラー画像を事前生成（毎フレームのフィルタ処理を避ける）
  function renderBlur(sharp, smear, n) {
    const c = document.createElement('canvas');
    c.width = SW * BLUR_S; c.height = (CH + PAD * 2) * BLUR_S;
    const x = c.getContext('2d');
    x.globalCompositeOperation = 'lighter';
    x.globalAlpha = 1 / n;
    for (let i = 0; i < n; i++) {
      const off = (i / (n - 1) - 0.5) * 2 * smear;
      x.drawImage(sharp, 0, (PAD + off) * BLUR_S, SW * BLUR_S, CH * BLUR_S);
    }
    return c;
  }
  function build() {
    const seen = {};
    Object.keys(STRIPS).forEach((k) => STRIPS[k].forEach((sym) => {
      if (seen[sym]) return;
      seen[sym] = true;
      const sharp = renderSharp(sym);
      imgs[sym] = { sharp, mid: renderBlur(sharp, 20, 9), heavy: renderBlur(sharp, 70, 19) };
    }));
  }

  function drawLayer(img, blurred, y, k, alpha) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha;
    const w = SW * k;
    if (blurred) { const h = (CH + PAD * 2) * k; ctx.drawImage(img, (W - w) / 2, y - h / 2, w, h); }
    else { const h = CH * k; ctx.drawImage(img, (W - w) / 2, y - h / 2, w, h); }
  }

  function draw(p, speed) {
    ctx.clearRect(0, 0, W, H);
    const sp = Math.abs(speed);
    // 速度に応じて シャープ → 弱ブラー → 強ブラー をクロスフェード
    let aS = 0, aM = 0, aH = 0;
    if (sp < 2.5) aS = 1;
    else if (sp < 9) { aM = (sp - 2.5) / 6.5; aS = 1 - aM; }
    else if (sp < 20) { aH = (sp - 9) / 11; aM = 1 - aH; }
    else aH = 1;
    const base = Math.floor(p);
    const n = strip.length;
    for (let i = base - 1; i <= base + 2; i++) {
      const d = p - i;                 // 0 で中央。p が増えると絵柄は下へ流れる
      const y = H / 2 + d * CH;
      const k = 1 - 0.1 * Math.min(1, d * d); // ドラム曲面の擬似遠近
      const im = imgs[strip[mod(i, n)]];
      drawLayer(im.heavy, true, y, k, aH * 0.92);
      drawLayer(im.mid, true, y, k, aM);
      drawLayer(im.sharp, false, y, k, aS);
      // セル境界の細いライン
      ctx.globalAlpha = 0.28 * (1 - aH);
      const ly = y + CH / 2;
      const g = ctx.createLinearGradient(40, 0, W - 40, 0);
      g.addColorStop(0, 'rgba(233,194,94,0)'); g.addColorStop(0.5, 'rgba(233,194,94,1)'); g.addColorStop(1, 'rgba(233,194,94,0)');
      ctx.fillStyle = g;
      ctx.fillRect(40, ly - 1, W - 80, 2);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 運動プロファイル ---------- */
  // 速度 v0→v1 の区間。k あり: v = v1+(v0-v1)(1-u)^k（ブレーキ的減速）/ なし: smoothstep
  function segDist(s, u) {
    if (s.k) return s.d * (s.v1 * u + (s.v0 - s.v1) * (1 - Math.pow(1 - u, s.k + 1)) / (s.k + 1));
    return s.d * (s.v0 * u + (s.v1 - s.v0) * (u * u * u - (u * u * u * u) / 2));
  }
  const seg = (d, v0, v1, k) => ({ d, v0, v1, k });

  function buildProfile(p0, st, sym) {
    const V = [0, 30, 32, 34][st];
    const tease = Math.random() < [0, 0.6, 0.85, 1][st];
    const TW = 0.2, AW = 0.11;                 // 始動時の「溜め」（わずかに逆方向へ引く）
    const vW = (AW * Math.PI) / TW;
    const vL = 1.15;                           // デテントに落ちる瞬間の速度
    const accel = seg(0.42, vW, V);
    const tail = [];
    let teaseAt = -1;
    if (tease) {
      const vP = 0.2, vPk = 1.55;
      const decT = [0, 2.7, 3.0, 3.5][st], pauseT = [0, 0.45, 0.6, 0.85][st];
      const X = seg(decT, V, vP, 2.2);
      const P = seg(pauseT, vP, vP);
      // 手前の絵柄の中心 -0.05 セルで止まりかけ、そこから残り 1.05 セルを倒れ込む
      const need = 1.05 - pauseT * vP;
      const nat = 0.55 * (vP + vPk) / 2 + 0.34 * (vPk + vL) / 2;
      const sc = need / nat;
      tail.push(X, P, seg(0.55 * sc, vP, vPk), seg(0.34 * sc, vPk, vL));
    } else {
      tail.push(seg([0, 2.5, 2.8, 3.2][st], V, vL + 0.5, 2.0), seg(0.45, vL + 0.5, vL));
    }
    let fixed = segDist(accel, 1);
    tail.forEach((s) => (fixed += segDist(s, 1)));
    const minCruise = 0.85 + Math.random() * 0.5;
    const n = STRIPS[st].length;
    let T = Math.ceil(p0 + fixed + V * minCruise);
    while (STRIPS[st][mod(T, n)] !== sym) T++;
    const cruise = seg((T - p0 - fixed) / V, V, V);
    const segs = [accel, cruise].concat(tail);
    // 区間開始時刻と開始位置を前計算
    let t = TW, p = p0;
    segs.forEach((s, i) => { s.t0 = t; s.p0 = p; t += s.d; p += segDist(s, 1); if (tease && i === 3) teaseAt = s.t0; });
    const tStop = t;
    const SET = 0.75, OM = 19, ZE = 7;
    function at(time) {
      if (time <= 0) return p0;
      if (time < TW) return p0 - AW * Math.sin((Math.PI * time) / TW);
      if (time >= tStop) {
        const u = time - tStop;
        if (u >= SET) return T;
        return T + (vL / OM) * Math.exp(-ZE * u) * Math.sin(OM * u) * (1 - u / SET);
      }
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        if (time >= s.t0) return s.p0 + segDist(s, Math.min(1, (time - s.t0) / s.d));
      }
      return p0;
    }
    return { at, T, V, tStop, total: tStop + SET, startAt: TW, teaseAt, teaseDur: tease ? tStop - teaseAt : 0 };
  }

  /* hooks: onStart, onTick(speedNorm), onSpeed(speedNorm), onTease(sec), onStop */
  function spin(st, sym, hooks) {
    hooks = hooks || {};
    return new Promise((resolve) => {
      const prof = buildProfile(pos, st, sym);
      const t0 = performance.now();
      let lastP = pos, lastT = 0, lastCell = Math.round(pos);
      let started = false, teased = false, stopped = false;
      cancelAnimationFrame(raf);
      function frame(now) {
        const t = (now - t0) / 1000;
        const p = prof.at(t);
        const dt = Math.max(0.001, t - lastT);
        const speed = (p - lastP) / dt;
        const norm = Math.min(1, Math.abs(speed) / prof.V);
        if (!started && t >= prof.startAt) { started = true; hooks.onStart && hooks.onStart(); }
        const cell = Math.round(p);
        if (cell !== lastCell && t < prof.tStop) { lastCell = cell; hooks.onTick && hooks.onTick(norm); }
        if (started && !stopped) hooks.onSpeed && hooks.onSpeed(norm);
        if (!teased && prof.teaseAt >= 0 && t >= prof.teaseAt) { teased = true; hooks.onTease && hooks.onTease(prof.teaseDur); }
        if (!stopped && t >= prof.tStop) { stopped = true; hooks.onSpeed && hooks.onSpeed(0); hooks.onStop && hooks.onStop(); }
        lastP = p; lastT = t;
        if (t >= prof.total) {
          pos = prof.T;
          draw(pos, 0);
          resolve();
          return;
        }
        draw(p, speed);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
    });
  }

  /* ステージ切替。show を指定するとその絵柄を中央に静止表示する。 */
  function setStage(st, show) {
    cancelAnimationFrame(raf);
    stage = st;
    strip = STRIPS[st];
    let idx = 0;
    if (show !== undefined) { const i = strip.indexOf(show); if (i >= 0) idx = i; }
    pos = idx;
    draw(pos, 0);
  }

  function init(canvas) {
    cv = canvas;
    cv.width = W * S; cv.height = H * S;
    ctx = cv.getContext('2d');
    ctx.setTransform(S, 0, 0, S, 0, 0);
    build();
    setStage(1);
  }

  return { init, spin, setStage, get stage() { return stage; } };
})();
