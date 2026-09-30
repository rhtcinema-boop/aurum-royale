/* プレイヤー画面の進行制御: レイアウト、レバー、抽選確定、ステージ演出、スタッフ認証。 */
const Game = (function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const CX = 770, CY = 420;          // リール窓の中心（#content 座標）
  const MSG_EMPTY = '抽選可能回数がありません。設定を確認してください。';
  let scale = 1, busy = false, curStage = 1, showingResult = false;
  let stageEl, cabinet, win, plate, lockbar, banner;

  /* ---------- レイアウト（16:9 基準・上下は背景で埋める） ---------- */
  function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const H = Math.min(1200, Math.max(900, Math.round(1600 * h / w)));
    scale = Math.min(w / 1600, h / H);
    stageEl.style.height = H + 'px';
    stageEl.style.transform = 'translate(' + (w - 1600 * scale) / 2 + 'px,' + (h - H * scale) / 2 + 'px) scale(' + scale + ')';
    $('content').style.top = (H - 900) / 2 + 'px';
  }

  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function flash(soft) { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = soft ? 'go-soft' : 'go'; }

  function buildBulbs() {
    const box = $('bulbs'), pts = [];
    const L = 31, T = 31, R = 809, B = 529;
    for (let x = 78; x <= 762; x += 57) pts.push([x, T]);
    for (let y = 84; y <= 476; y += 56) pts.push([R, y]);
    for (let x = 762; x >= 78; x -= 57) pts.push([x, B]);
    for (let y = 476; y >= 84; y -= 56) pts.push([L, y]);
    pts.forEach((p, i) => {
      const b = document.createElement('i');
      b.style.left = p[0] + 'px'; b.style.top = p[1] + 'px';
      b.style.animationDelay = 'calc(var(--bulb) * ' + (-(i / pts.length) * 4).toFixed(3) + ')';
      box.appendChild(b);
    });
  }

  function setStage(n, show) {
    curStage = n;
    stageEl.dataset.stage = n;
    document.querySelectorAll('#ladder .rung').forEach((r) => {
      const s = +r.dataset.s;
      r.classList.toggle('on', s === n);
      r.classList.toggle('done', s < n);
    });
    FX.setAmbient([0, 0, 7, 16][n], n === 3 ? ['gold', 'white', 'red'] : ['gold', 'gold', 'white']);
    Reel.setStage(n, show);
  }

  function setPlate(mode, main, sub) {
    plate.className = 'plate ' + mode;
    $('plateMain').textContent = main || '';
    $('plateSub').textContent = sub || '';
    $('plateSub').style.display = sub ? '' : 'none';
  }

  /* ---------- レバー ---------- */
  const Lever = (function () {
    const TRAVEL = 400, NOTCH = 40;
    let y = 0, v = 0, enabled = false, dragging = false, startY = 0, startPos = 0, raf = 0, notch = 0, homeSound = false;
    let el, knob, glow, led, onPull = null;

    function set(ny) {
      y = ny;
      knob.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
      glow.style.height = (y + 56).toFixed(1) + 'px';
    }
    // 減衰バネで目標位置へ。上端に当たると小さく跳ね返る（重量感）
    function spring(to, k, c) {
      cancelAnimationFrame(raf);
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(0.034, (now - last) / 1000);
        last = now;
        for (let i = 0; i < 4; i++) {
          const h = dt / 4;
          v += (-k * (y - to) - c * v) * h;
          y += v * h;
          if (y < 0) { y = 0; if (homeSound && v < -120) { Sfx.play('leverHome'); homeSound = false; } v = -v * 0.32; }
          if (y > TRAVEL) { y = TRAVEL; v = -v * 0.2; }
        }
        set(y);
        if (Math.abs(y - to) < 0.4 && Math.abs(v) < 6) { set(to); v = 0; raf = 0; return; }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    function deny() {
      restart(el, 'deny');
      Sfx.play('leverDeny');
      if (plate.classList.contains('error')) restart(plate, 'bump');
    }
    function down(e) {
      e.preventDefault();
      Sfx.unlock();
      if (!enabled) return deny();
      dragging = true;
      try { knob.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      cancelAnimationFrame(raf);
      v = 0; startY = e.clientY; startPos = y; notch = Math.floor(y / NOTCH);
      el.classList.add('grab');
      Sfx.play('leverTouch');
    }
    function move(e) {
      if (!dragging) return;
      const ny = Math.max(0, Math.min(TRAVEL, startPos + (e.clientY - startY) / scale));
      const n = Math.floor(ny / NOTCH);
      if (n !== notch) { notch = n; Sfx.play('ratchet', ny / TRAVEL); }
      set(ny);
      if (ny >= TRAVEL * 0.97) commit();
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('grab');
      homeSound = y > 60;
      if (homeSound) Sfx.play('leverReturn');
      spring(0, 170, 14); // 引き切らずに離した: 自然に元の位置へ戻る
    }
    function commit() {
      dragging = false;
      el.classList.remove('grab');
      setEnabled(false);
      set(TRAVEL); v = 0;
      Sfx.play('leverCommit');
      restart(cabinet, 'thud');
      if (onPull) onPull();
      setTimeout(() => { homeSound = true; Sfx.play('leverReturn'); spring(0, 150, 12); }, 280);
    }
    function setEnabled(on) {
      enabled = on;
      el.classList.toggle('ready', on);
      led.textContent = on ? 'READY' : 'LOCKED';
      if (!on && dragging) { dragging = false; el.classList.remove('grab'); spring(0, 170, 14); }
    }
    function init(cb) {
      el = $('lever'); knob = $('leverKnob'); glow = $('leverGlow'); led = $('leverLed');
      onPull = cb;
      knob.addEventListener('pointerdown', down);
      knob.addEventListener('pointermove', move);
      knob.addEventListener('pointerup', up);
      knob.addEventListener('pointercancel', up);
      knob.addEventListener('lostpointercapture', up);
      set(0);
      setEnabled(false);
    }
    return { init, setEnabled };
  })();

  /* ---------- 状態 → 画面 ---------- */
  function canPlay() {
    const s = Store.state;
    return !!(s.pins && s.session && !s.locked && !s.play && Engine.sumCounts(s.session.remaining) > 0);
  }
  function refresh() {
    if (busy) return;
    const s = Store.state;
    if (s.play) return showLocked(s.play, false);
    lockbar.classList.remove('show');
    win.classList.remove('win', 'lose');
    cabinet.classList.remove('party');
    if (showingResult || curStage !== 1) { showingResult = false; setStage(1); }
    const ok = canPlay();
    Lever.setEnabled(ok);
    if (ok) setPlate('idle', 'PULL THE LEVER', 'レバーを下まで引いてください');
    else setPlate('error', MSG_EMPTY);
  }

  /* 結果表示＋レバー完全ロック（再起動時の復元にも使用） */
  function showLocked(play, animate) {
    showingResult = true;
    Lever.setEnabled(false);
    if (!animate) {
      setStage(play.stage, play.value);
      win.classList.toggle('win', play.value > 0);
      win.classList.toggle('lose', play.value === 0);
    }
    plate.classList.add('hidden');
    renderLockbar(false);
    lockbar.classList.add('show');
  }
  function renderLockbar(authed) {
    const p = Store.state.play;
    lockbar.innerHTML =
      '<div class="res"><small>RESULT</small><b class="' + (p.value === 0 ? 'zero' : '') + '">' + fmtN(p.value) + '</b></div>' +
      '<div class="side">' + (authed
        ? '<span class="note">認証済み</span><button class="btn" data-act="next">次のプレイへ</button>'
        : '<span class="note">次のプレイにはスタッフ認証が必要です</span><button class="btn ghost" data-act="auth">スタッフ認証</button>') + '</div>';
  }
  async function onLockbar(e) {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    Sfx.play('button');
    if (b.dataset.act === 'auth') {
      const role = await UI.auth('スタッフ認証', ['staff', 'admin'], '次プレイ認証', '営業設定PINを入力');
      if (role && Store.state.play) { lockbar.dataset.role = role; renderLockbar(true); }
      return;
    }
    if (b.dataset.act === 'next') {
      const role = lockbar.dataset.role || 'staff';
      try {
        Store.transact((s) => {
          Store.log('NEXT_PLAY', { playNo: s.play ? s.play.playNo : null }, role);
          s.play = null; s.locked = false;
        });
      } catch (err) { return UI.toast('保存に失敗しました: ' + err.message, 'err'); }
      busy = true;
      lockbar.classList.remove('show');
      await transition(1);
      win.classList.remove('win', 'lose');
      showingResult = false;
      busy = false;
      refresh();
    }
  }

  /* ---------- 抽選確定 ----------
     レバーを引き切った瞬間に「抽選・在庫消費・ロック・履歴」を1回の書き込みで確定する。
     以降の演出は確定済みの結果をなぞるだけなので、途中で落ちても再抽選は起きない。 */
  function onPull() {
    const s0 = Store.state;
    if (busy || !s0.session || s0.locked || s0.play) return refresh();
    let res;
    try {
      Store.transact((s) => {
        const ses = s.session;
        const before = Engine.sumCounts(ses.remaining);
        res = Engine.draw(ses);
        Engine.applyDraw(ses, res);
        s.play = { playNo: ses.playNo, stage: res.stage, value: res.value, overflow: res.overflow, phase: 'drawn', ts: Date.now() };
        s.locked = true;
        Store.log(res.overflow ? 'OVERFLOW_PLAY' : 'PLAY', {
          playNo: ses.playNo, stage: res.stage, value: res.value, key: res.key, path: Engine.pathFor(res.stage),
          remainBefore: before, remainAfter: Engine.sumCounts(ses.remaining), label: res.overflow ? '超過プレイ / 0' : undefined,
        });
      });
    } catch (err) {
      UI.toast('抽選を開始できませんでした（保存エラー）。', 'err');
      return refresh();
    }
    run(res);
  }

  async function run(res) {
    busy = true;
    for (let st = 1; st <= res.stage; st++) {
      const sym = st < res.stage ? 'NEXT' : res.value;
      setPlate('spin', 'GOOD LUCK', 'STAGE ' + st);
      if (st > 1) await wait(550);
      await spinReel(st, sym);
      if (sym === 'NEXT') await nextStageFx(st);
    }
    await resultFx(res);
    try { Store.transact((s) => { if (s.play) s.play.phase = 'shown'; }); } catch (err) { /* 表示済みフラグのみ。失敗しても整合性に影響なし */ }
    showLocked(Store.state.play, true);
    busy = false;
  }

  function spinReel(st, sym) {
    const beats = [];
    return Reel.spin(st, sym, {
      onStart: () => Sfx.play('reelStart'),
      onTick: (n) => Sfx.tick(n),
      onSpeed: (n) => Sfx.spin(n),
      onTease: (dur) => {
        Sfx.play('tease', dur);
        $('content').querySelector('.spot').style.opacity = 1;
        if (st >= 2) for (let t = 0; t < dur - 0.2; t += 0.62) beats.push(setTimeout(() => Sfx.play('heartbeat'), t * 1000));
      },
      onStop: () => {
        beats.forEach(clearTimeout);
        $('content').querySelector('.spot').style.opacity = '';
        Sfx.play('stop');
        restart(cabinet, 'thud');
      },
    });
  }

  /* NEXT STAGE: 静止 → 光が集まる → 衝撃・フラッシュ → 強調表示 → シャッターで次ステージへ */
  async function nextStageFx(st) {
    setPlate('spin', 'NEXT STAGE', '');
    await wait(380);
    $('dim').classList.add('on');
    FX.converge(CX, CY, 150, 1.0);
    Sfx.play('riser');
    win.classList.add('win');
    await wait(1000);
    flash(false);
    restart(cabinet, 'shake');
    cabinet.classList.add('party');
    Sfx.play('impact');
    FX.ring(CX, CY, 'white', 1000, 0.8);
    FX.burst(CX, CY, 220, { max: 1300, life: 1.8, size: 26 });
    setTimeout(() => FX.ring(CX, CY, 'gold', 1200, 1.0), 140);
    showBanner('next', '', 'NEXT STAGE');
    await wait(1700);
    await hideBanner();
    $('dim').classList.remove('on');
    await transition(st + 1);
    win.classList.remove('win');
    cabinet.classList.remove('party');
  }

  /* 金属シャッターが閉じ、裏でステージを切り替えて開く */
  async function transition(to) {
    const label = $('shutterLabel');
    label.querySelector('b').textContent = to;
    label.classList.remove('show');
    stageEl.classList.remove('opening');
    stageEl.classList.add('shut');
    Sfx.play('shutterClose');
    await wait(440);
    flash(true);
    label.classList.add('show');
    FX.clear();
    setStage(to);
    await wait(900);
    Sfx.play('shutterOpen');
    stageEl.classList.add('opening');
    stageEl.classList.remove('shut');
    label.classList.remove('show');
    await wait(720);
    stageEl.classList.remove('opening');
  }

  function showBanner(kind, label, value) {
    banner.className = 'banner ' + kind;
    $('bannerLabel').textContent = label;
    $('bannerValue').textContent = value;
    void banner.offsetWidth;
    banner.classList.add('show');
    win.classList.add('veil'); // リール上の同じ文字と重ならないよう一時的に沈める
  }
  async function hideBanner() {
    banner.classList.add('out');
    win.classList.remove('veil');
    await wait(460);
    banner.className = 'banner';
  }

  async function resultFx(res) {
    const v = res.value;
    if (v === 0) {
      await wait(250);
      win.classList.add('lose');
      Sfx.play('zero');
      setPlate('result zero', '0', '');
      await wait(1700);
      return;
    }
    const tier = v >= 10000 ? 'big' : v >= 2000 ? 'mid' : 'small';
    await wait(tier === 'big' ? 500 : 250); // 一拍置いてから祝福
    win.classList.add('win');
    cabinet.classList.add('party');
    setPlate('spin', 'WIN', '');
    showBanner('win', 'WIN', fmtN(v));
    const timers = [];
    if (tier === 'small') {
      Sfx.play('winSmall');
      flash(true);
      FX.burst(CX, CY, 90, { max: 800 });
      await wait(2500);
    } else if (tier === 'mid') {
      Sfx.play('winMid');
      flash(true);
      FX.ring(CX, CY, 'gold', 900, 0.7);
      FX.burst(CX, CY, 170, { max: 1100, life: 1.7 });
      FX.rain(110, 1.6);
      await wait(3600);
    } else {
      const jackpot = v >= 100000;
      Sfx.play('winBig', jackpot);
      flash(false);
      restart(cabinet, 'shake');
      FX.ring(CX, CY, 'white', 1100, 0.8);
      FX.burst(CX, CY, 260, { max: 1400, life: 2, size: 28 });
      const dur = jackpot ? 7.5 : 4.6;
      FX.rain(jackpot ? 520 : 300, dur - 1.2);
      for (let t = 0.5; t < dur - 1; t += jackpot ? 0.45 : 0.7) {
        timers.push(setTimeout(() => {
          const x = 250 + Math.random() * 1100, y = 150 + Math.random() * 520;
          FX.burst(x, y, 70, { max: 700, colors: ['gold', 'white', 'gold', curStage === 3 ? 'red' : 'gold'] });
          FX.ring(x, y, 'gold', 260, 0.5);
        }, t * 1000));
      }
      if (jackpot) timers.push(setTimeout(() => { flash(false); restart(cabinet, 'shake'); FX.ring(CX, CY, 'white', 1200, 0.9); }, 2600));
      await wait(dur * 1000);
    }
    timers.forEach(clearTimeout);
    await hideBanner();
    cabinet.classList.remove('party');
    setPlate('result', fmtN(v), '');
  }

  /* ---------- 設定画面への隠し入口（左上エンブレム長押し） ---------- */
  function initSecret() {
    const crest = $('crest');
    let timer = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; crest.classList.remove('holding'); };
    crest.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (busy || !Store.state.pins) return;
      crest.classList.add('holding');
      timer = setTimeout(async () => {
        cancel();
        Sfx.play('button');
        const role = await UI.auth('PINを入力', ['staff', 'admin'], '設定画面', '営業設定PIN または 管理者PIN');
        if (!role || busy) return;
        try { Store.transact(() => Store.log('ADMIN_LOGIN', {}, role)); } catch (err) { /* ログのみ */ }
        Admin.open(role);
      }, 2500);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => crest.addEventListener(ev, cancel));
  }

  async function firstRun() {
    await UI.confirm({
      title: '初期設定', ok: '登録を始める', cancel: false,
      html: '<p>ご利用の前に、2種類のPIN（4〜8桁の数字）を登録してください。登録が完了するまでアプリは使用できません。</p>' +
        '<dl class="kv"><dt>営業設定PIN</dt><dd>日常の営業設定・営業開始/終了・プレイ後のスタッフ認証</dd><dt>管理者PIN</dt><dd>履歴閲覧・プライズ上限ルール・PIN再発行など</dd></dl>' +
        '<p style="color:#8e8672;font-size:16px">登録後、設定画面は画面左上のエンブレムを約3秒長押しして開きます。</p>',
    });
    const staff = await UI.askNewPin('営業設定PINの登録', { solid: true, cancelable: false });
    const admin = await UI.askNewPin('管理者PINの登録', { solid: true, cancelable: false, differPin: staff, differMsg: '営業設定PINと同じ番号は使用できません。' });
    Store.transact((s) => {
      s.pins = { staff: Engine.makePin(staff), admin: Engine.makePin(admin) };
      Store.log('PIN_SETUP', {});
    });
    UI.toast('PINを登録しました。左上のエンブレムを長押しして営業設定を行ってください。', 'ok');
  }

  function guardGestures() {
    const scrollable = (t) => t.closest && t.closest('.adm-body, .dialog .body');
    document.addEventListener('touchmove', (e) => { if (!scrollable(e.target)) e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick', 'selectstart'].forEach((ev) =>
      document.addEventListener(ev, (e) => { if (!(e.target.tagName === 'INPUT')) e.preventDefault(); }));
    // 画面スリープ防止（対応端末のみ）
    const lock = () => { if (navigator.wakeLock && !document.hidden) navigator.wakeLock.request('screen').catch(() => {}); };
    document.addEventListener('visibilitychange', lock);
    window.addEventListener('pointerdown', lock, { once: true });
  }

  async function init() {
    stageEl = $('stage'); cabinet = $('cabinet'); win = $('window'); plate = $('plate'); lockbar = $('lockbar'); banner = $('banner');
    layout();
    window.addEventListener('resize', layout);
    if (window.ResizeObserver) new ResizeObserver(layout).observe($('viewport'));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 300));
    guardGestures();
    try { Store.init(); }
    catch (err) {
      document.body.innerHTML = '<p style="color:#ff9d8c;padding:40px;font-size:20px">保存領域を利用できないため起動できません。プライベートブラウズを解除するか、ブラウザの設定を確認してください。<br>' + esc(err.message) + '</p>';
      return;
    }
    Sfx.init(Store.state.settings.volume);
    buildBulbs();
    FX.init($('fx'));
    Reel.init($('reel'));
    Lever.init(onPull);
    lockbar.addEventListener('click', onLockbar);
    initSecret();
    setStage(1);
    refresh();
    await new Promise((resolve) => {
      const sp = $('splash');
      sp.addEventListener('click', () => {
        Sfx.unlock();
        Sfx.play('ok');
        sp.classList.add('bye');
        setTimeout(() => sp.remove(), 600);
        resolve();
      }, { once: true });
    });
    if (!Store.state.pins) { await firstRun(); refresh(); }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
  return { refresh };
})();
