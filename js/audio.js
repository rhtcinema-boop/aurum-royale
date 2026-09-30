/* 効果音。音声ファイルは使わず WebAudio で全SEを合成する（オフラインでも動作）。
   iOS の自動再生制限のため、最初のタッチで AudioContext を resume する。 */
const Sfx = (function () {
  'use strict';
  let ctx = null, master = null, revSend = null, noiseBuf = null;
  let spinSrc = null, spinGain = null, spinFilter = null;
  let volume = 0.9, lastTick = 0, resumeAt = -1e9;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(comp); comp.connect(ctx.destination);

    // ノイズ素材
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // 簡易リバーブ（ベル・衝撃音の余韻用）
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    revSend = ctx.createGain();
    revSend.gain.value = 0.5;
    revSend.connect(conv); conv.connect(master);
    return true;
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state !== 'running') { resumeAt = performance.now(); ctx.resume().catch(() => {}); }
  }
  // resume 直後（同じタッチ内）の音は、開始待ちの間でも予約して鳴らす
  function ready() {
    return ensure() && (ctx.state === 'running' || performance.now() - resumeAt < 600);
  }

  function out(node, rev) {
    node.connect(master);
    if (rev) {
      const g = ctx.createGain();
      g.gain.value = rev;
      node.connect(g); g.connect(revSend);
    }
  }
  function envelope(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  /* o: {type,f,f2,at,a,d,g,rev,lp} */
  function tone(o) {
    const t = ctx.currentTime + (o.at || 0), a = o.a || 0.004, d = o.d || 0.1;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
    const g = ctx.createGain();
    envelope(g, t, a, d, o.g || 0.2);
    let head = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.7;
      osc.connect(f); head = f;
    }
    head.connect(g);
    out(g, o.rev);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }
  /* o: {ft,f,f2,q,at,a,d,g,rev} */
  function noise(o) {
    const t = ctx.currentTime + (o.at || 0), a = o.a || 0.002, d = o.d || 0.05;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.ft || 'bandpass';
    f.frequency.setValueAtTime(o.f, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    envelope(g, t, a, d, o.g || 0.2);
    src.connect(f); f.connect(g);
    out(g, o.rev);
    src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  }
  function bell(f, at, d, g) {
    tone({ f, at, d, g, rev: 0.5 });
    tone({ f: f * 2.01, at, d: d * 0.6, g: g * 0.35, rev: 0.4 });
    tone({ f: f * 3.02, at, d: d * 0.35, g: g * 0.15 });
  }
  function clang(at, g, d) {
    [311, 466, 702, 1051, 1580, 2370].forEach((f, i) =>
      tone({ type: i % 2 ? 'triangle' : 'sine', f: f * (1 + Math.random() * 0.01), at, d: d * (1 - i * 0.1), g: g * (1 - i * 0.12), rev: 0.6 })
    );
  }
  function brass(f, at, d, g) {
    tone({ type: 'sawtooth', f, at, a: 0.03, d, g, lp: 2200, rev: 0.35 });
    tone({ type: 'sawtooth', f: f * 1.005, at, a: 0.03, d, g: g * 0.7, lp: 1800 });
  }
  const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, E7: 2637, G7: 3136 };

  const SOUNDS = {
    leverTouch() {
      noise({ f: 2600, q: 2, d: 0.04, g: 0.22 });
      tone({ f: 190, f2: 120, d: 0.07, g: 0.3 });
    },
    ratchet(p) {
      noise({ f: 1700 + p * 1500, q: 3, d: 0.028, g: 0.2 + p * 0.1 });
      tone({ type: 'square', f: 700 + p * 600, d: 0.014, g: 0.04 });
    },
    leverCommit() {
      tone({ f: 120, f2: 42, d: 0.3, g: 1.0 });
      noise({ ft: 'lowpass', f: 1100, d: 0.13, g: 0.6 });
      clang(0.01, 0.07, 0.5);
    },
    leverReturn() {
      noise({ f: 500, f2: 2000, q: 1.2, a: 0.05, d: 0.22, g: 0.14 });
    },
    leverHome() {
      tone({ f: 170, f2: 85, d: 0.09, g: 0.5 });
      noise({ ft: 'lowpass', f: 900, d: 0.06, g: 0.32 });
    },
    leverDeny() {
      tone({ type: 'square', f: 150, d: 0.09, g: 0.12, lp: 900 });
      noise({ ft: 'lowpass', f: 500, d: 0.06, g: 0.3 });
    },
    reelStart() {
      noise({ f: 280, f2: 2600, q: 0.9, a: 0.35, d: 0.25, g: 0.28 });
      tone({ type: 'sawtooth', f: 55, f2: 190, a: 0.3, d: 0.25, g: 0.12, lp: 900 });
    },
    stop() {
      tone({ f: 150, f2: 55, d: 0.2, g: 1.0 });
      noise({ ft: 'lowpass', f: 1400, d: 0.08, g: 0.55 });
      tone({ type: 'triangle', f: 920, d: 0.14, g: 0.1, rev: 0.4 });
    },
    tease(dur) {
      tone({ type: 'triangle', f: 330, f2: 700, a: dur * 0.9, d: dur * 0.1, g: 0.09, rev: 0.4 });
      tone({ f: 165, f2: 352, a: dur * 0.9, d: dur * 0.1, g: 0.12 });
    },
    heartbeat() {
      tone({ f: 62, f2: 38, d: 0.14, g: 0.85 });
      tone({ f: 58, f2: 36, at: 0.2, d: 0.14, g: 0.55 });
    },
    zero() {
      tone({ f: 196, f2: 120, d: 0.5, g: 0.22, rev: 0.4 });
      tone({ f: 147, f2: 82, at: 0.16, d: 0.7, g: 0.24, rev: 0.4 });
      noise({ ft: 'lowpass', f: 320, at: 0.16, d: 0.4, g: 0.2 });
    },
    winSmall() {
      [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => bell(f, i * 0.085, 0.7, 0.22));
      noise({ ft: 'highpass', f: 6000, at: 0.3, a: 0.05, d: 0.6, g: 0.05 });
    },
    winMid() {
      tone({ f: 90, f2: 45, d: 0.4, g: 0.7 });
      [N.G5, N.C6, N.E6, N.G6, N.C7, N.E7].forEach((f, i) => bell(f, i * 0.075, 0.9, 0.22));
      [N.C6, N.E6, N.G6, N.C7].forEach((f) => bell(f, 0.62, 1.6, 0.14));
      brass(N.C5 / 2, 0.0, 0.5, 0.1); brass(N.G5 / 2, 0.3, 0.9, 0.1);
      for (let i = 0; i < 10; i++) bell(N.C7 * (1 + Math.random()), 0.9 + i * 0.09, 0.4, 0.07);
      noise({ ft: 'highpass', f: 5000, at: 0.5, a: 0.2, d: 1.4, g: 0.06 });
    },
    winBig(long) {
      tone({ f: 80, f2: 28, d: 1.1, g: 1.0 });
      noise({ ft: 'lowpass', f: 3500, f2: 200, d: 0.6, g: 0.6 });
      clang(0, 0.1, 1.6);
      // ファンファーレ
      const seq = [[N.C5, 0.0, 0.22], [N.C5, 0.24, 0.12], [N.C5, 0.38, 0.12], [N.E5, 0.52, 0.3], [N.G5, 0.86, 0.3], [N.C6, 1.2, 1.4]];
      seq.forEach(([f, at, d]) => { brass(f / 2, at, d + 0.15, 0.13); brass(f, at, d + 0.15, 0.08); });
      [N.E5, N.G5].forEach((f) => brass(f, 1.2, 1.5, 0.06));
      const scale = [N.C6, N.E6, N.G6, N.C7, N.E7, N.G7];
      const total = long ? 6.5 : 3.6;
      for (let t = 0.2; t < total; t += 0.07) bell(scale[Math.floor(Math.random() * scale.length)], t, 0.5, 0.07 + Math.random() * 0.05);
      [N.C6, N.E6, N.G6, N.C7].forEach((f) => bell(f, 1.2, 2.4, 0.13));
      noise({ ft: 'highpass', f: 4500, at: 0.2, a: 0.6, d: total - 0.8, g: 0.07 });
      if (long) {
        tone({ f: 70, f2: 30, at: 2.6, d: 1.0, g: 0.9 });
        [N.C5, N.E5, N.G5, N.C6].forEach((f) => brass(f, 2.6, 2.6, 0.06));
        [N.C6, N.E6, N.G6, N.C7].forEach((f) => bell(f, 2.6, 3, 0.12));
      }
    },
    /* 当選レベル 1〜8。上のレベルほど音数・長さ・低音が増える。 */
    win(L) {
      if (L <= 2) {
        SOUNDS.winSmall();
        if (L === 2) { [N.E6, N.G6, N.C7, N.E7].forEach((f, i) => bell(f, 0.42 + i * 0.08, 0.9, 0.18)); tone({ f: 90, f2: 50, d: 0.3, g: 0.5 }); }
        return;
      }
      if (L <= 5) {
        SOUNDS.winMid();
        if (L >= 4) { brass(N.C5, 0.62, 1.1, 0.09); brass(N.E5, 0.62, 1.1, 0.06); clang(0, 0.06, 1.0); }
        if (L >= 5) {
          tone({ f: 80, f2: 30, d: 0.9, g: 0.95 });
          [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => brass(f / 2, 1.5 + i * 0.16, 0.5, 0.1));
          for (let t = 1.6; t < 3.8; t += 0.08) bell(N.C6 * Math.pow(2, Math.floor(Math.random() * 12) / 12), t, 0.4, 0.06);
        }
        return;
      }
      SOUNDS.winBig(L >= 7);
      if (L >= 8) { // ジャックポット: ファンファーレをもう一段上で重ねる
        const at = 5.4, up = 1.1225;
        tone({ f: 80, f2: 28, at, d: 1.2, g: 1.0 });
        clang(at, 0.1, 1.8);
        [[N.C5, 0, 0.2], [N.C5, 0.24, 0.12], [N.E5, 0.4, 0.3], [N.G5, 0.74, 0.3], [N.C6, 1.08, 2.4]].forEach(([f, o, d]) => { brass(f * up / 2, at + o, d + 0.15, 0.13); brass(f * up, at + o, d + 0.15, 0.08); });
        const sc = [N.C6, N.E6, N.G6, N.C7, N.E7, N.G7];
        for (let t = at; t < at + 5.2; t += 0.06) bell(sc[Math.floor(Math.random() * sc.length)] * up, t, 0.5, 0.06 + Math.random() * 0.05);
        noise({ ft: 'highpass', f: 4500, at, a: 0.6, d: 4.4, g: 0.07 });
      }
    },
    riser() {
      noise({ f: 180, f2: 7000, q: 1.4, a: 0.95, d: 0.04, g: 0.4 });
      tone({ type: 'sawtooth', f: 70, f2: 700, a: 0.95, d: 0.04, g: 0.13, lp: 2400 });
      tone({ f: 220, f2: 1760, a: 0.95, d: 0.04, g: 0.1, rev: 0.4 });
    },
    impact() {
      tone({ f: 85, f2: 26, d: 1.1, g: 1.0 });
      noise({ ft: 'lowpass', f: 4000, f2: 180, d: 0.55, g: 0.7, rev: 0.4 });
      clang(0, 0.13, 1.5);
      [N.G5, N.C6, N.E6, N.G6, N.C7].forEach((f, i) => bell(f, 0.22 + i * 0.07, 0.9, 0.18));
      [N.C6, N.G6, N.C7].forEach((f) => bell(f, 0.62, 1.4, 0.1));
      brass(N.C5 / 2, 0.22, 0.9, 0.1); brass(N.G5 / 2, 0.22, 0.9, 0.07);
    },
    shutterClose() {
      noise({ f: 1800, f2: 260, q: 0.8, a: 0.05, d: 0.4, g: 0.3 });
      tone({ f: 75, f2: 36, at: 0.42, d: 0.4, g: 1.0 });
      noise({ ft: 'lowpass', f: 1500, at: 0.42, d: 0.12, g: 0.6 });
      clang(0.42, 0.08, 0.9);
    },
    shutterOpen() {
      tone({ f: 60, f2: 40, d: 0.15, g: 0.6 });
      noise({ f: 260, f2: 2200, q: 0.8, a: 0.1, d: 0.45, g: 0.28 });
      [N.C6, N.G6].forEach((f, i) => bell(f, 0.3 + i * 0.1, 0.8, 0.1));
    },
    button() {
      tone({ f: 820, d: 0.05, g: 0.13 });
      noise({ f: 3000, q: 2, d: 0.02, g: 0.1 });
    },
    key() {
      tone({ f: 1250, d: 0.035, g: 0.1 });
      noise({ f: 3500, q: 2, d: 0.015, g: 0.07 });
    },
    ok() {
      bell(N.E6, 0, 0.5, 0.16); bell(N.B6, 0.09, 0.7, 0.16);
    },
    error() {
      tone({ type: 'square', f: 170, d: 0.13, g: 0.16, lp: 1100 });
      tone({ type: 'square', f: 130, at: 0.17, d: 0.2, g: 0.16, lp: 1100 });
    },
  };

  function play(name, arg) {
    if (!ready()) return;
    try { SOUNDS[name](arg); } catch (e) { /* 音の失敗でゲーム進行を止めない */ }
  }

  /* リール通過音。speed は 0..1（1=最高速）。高速時は間引く。 */
  function tick(speed) {
    if (!ready()) return;
    const now = ctx.currentTime;
    if (now - lastTick < 0.034) return;
    lastTick = now;
    const slow = 1 - Math.min(1, speed * 3);
    noise({ f: 2400 - slow * 900, q: 2.5, d: 0.016 + slow * 0.02, g: 0.1 + slow * 0.16 });
    if (slow > 0.2) tone({ type: 'triangle', f: 620 + slow * 160, d: 0.03 + slow * 0.03, g: 0.08 + slow * 0.2 });
  }

  /* 回転ノイズ（ループ）。speed 0 で停止。 */
  function spin(speed) {
    if (!ready()) return;
    if (!spinSrc) {
      if (speed <= 0) return;
      spinSrc = ctx.createBufferSource();
      spinSrc.buffer = noiseBuf; spinSrc.loop = true;
      spinFilter = ctx.createBiquadFilter();
      spinFilter.type = 'bandpass'; spinFilter.Q.value = 0.8;
      spinGain = ctx.createGain();
      spinGain.gain.value = 0;
      spinSrc.connect(spinFilter); spinFilter.connect(spinGain); spinGain.connect(master);
      spinSrc.start();
    }
    const t = ctx.currentTime;
    spinGain.gain.setTargetAtTime(0.2 * speed, t, 0.05);
    spinFilter.frequency.setTargetAtTime(350 + 2300 * speed, t, 0.05);
    if (speed <= 0) {
      const s = spinSrc;
      spinSrc = null;
      s.stop(t + 0.3);
    }
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  }

  function init(v) {
    if (typeof v === 'number') volume = v;
    // 以後のあらゆるタッチで（中断からの）復帰を試みる
    ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); });
  }

  return { init, unlock, play, tick, spin, setVolume };
})();
