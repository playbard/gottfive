/**
 * ゴットファイブ！ オーディオシステム
 * BGM: ユーザー提供MP3ファイル
 * SE:  Web Audio APIで生成（PS2カジノゲーム調）
 */

const AudioSystem = (() => {
  let ctx = null;
  let masterGain = null;
  let bgmGain = null;
  let seGain = null;
  let bgmSource = null;
  let bgmBuffer = null;
  let currentBgm = null;
  let bgmLoading = false; // 非同期ロード中の多重実行防止フラグ
  let enabled = true;
  let volumeLevel = 0.7; // 0.0 〜 1.0
  const BGM_GAIN = 0.09;  // BGMは控えめ
  const SE_GAIN  = 2.2;   // SEは派手に

  // AudioContextの遅延初期化（ユーザー操作後に生成）
  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volumeLevel;
      masterGain.connect(ctx.destination);

      bgmGain = ctx.createGain();
      bgmGain.gain.value = BGM_GAIN;
      bgmGain.connect(masterGain);

      seGain = ctx.createGain();
      seGain.gain.value = SE_GAIN;
      seGain.connect(masterGain);
    }
    return ctx;
  }

  // ========== BGM ==========
  // url → AudioBuffer のキャッシュ（ユーザー操作前でも fetch・decode だけは可能）
  const bufferCache = {};

  // バックグラウンドでバッファを先読み（AudioContext不要、fetch＋decode）
  async function preloadBgm(url) {
    if (bufferCache[url]) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const raw = await res.arrayBuffer();
      // decode には AudioContext が必要なため、あれば即デコード、なければ raw を保持
      if (ctx) {
        bufferCache[url] = await ctx.decodeAudioData(raw);
      } else {
        bufferCache[url] = raw; // ArrayBuffer として保持し、再生時にデコード
      }
    } catch {}
  }

  async function playBgm(url) {
    if (!enabled) return;
    // 同じBGMがすでに再生中、またはロード中なら何もしない
    if (currentBgm === url && (bgmSource || bgmLoading)) return;

    bgmLoading = true;
    const c = getCtx();
    if (c.state === 'suspended') await c.resume();

    if (bgmSource) {
      try { bgmSource.stop(); } catch {}
      bgmSource = null;
    }

    // キャッシュ確認
    let buf = bufferCache[url];
    if (buf instanceof ArrayBuffer) {
      buf = await c.decodeAudioData(buf);
      bufferCache[url] = buf;
    } else if (!buf) {
      try {
        const res = await fetch(url);
        if (!res.ok) { bgmLoading = false; return; }
        const raw = await res.arrayBuffer();
        buf = await c.decodeAudioData(raw);
        bufferCache[url] = buf;
      } catch { bgmLoading = false; return; }
    }

    currentBgm = url;
    bgmLoading = false;
    startBgmBuffer(buf);
  }

  function startBgmBuffer(buf) {
    const c = getCtx();
    bgmSource = c.createBufferSource();
    bgmSource.buffer = buf;
    bgmSource.loop = true;
    bgmSource.connect(bgmGain);
    bgmSource.start(0);
  }

  function stopBgm() {
    if (bgmSource) {
      try { bgmSource.stop(); } catch {}
      bgmSource = null;
    }
    currentBgm = null;
    bgmLoading = false;
  }

  // ========== SE生成ユーティリティ ==========
  function osc(type, freq, startTime, duration, gainVal, c) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    o.connect(g);
    g.connect(seGain);
    o.start(startTime);
    o.stop(startTime + duration + 0.01);
    return { o, g };
  }

  function noise(startTime, duration, gainVal, c) {
    const bufSize = c.sampleRate * duration;
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.8;
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(seGain);
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }

  // ========== 各SE（パチスロ風）==========

  // タイル公開：リール始動音（高速回転ブブブ＋フラッシュ的な光感）
  function seFlipTile() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    // 高速ビープ連打でリール回転感
    for (let i = 0; i < 6; i++) {
      osc('square', 800 + i * 80, t + i * 0.03, 0.04, 0.3, c);
    }
    // ノイズバースト
    noise(t, 0.08, 0.25, c);
    // 締めの高音
    osc('sine', 1400, t + 0.18, 0.1, 0.35, c);
  }

  // タイル選択：ボタン押下音（スロットのストップボタン）
  function seSelectTile() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    // 重いクリック感
    noise(t, 0.03, 0.5, c);
    osc('square', 200, t, 0.06, 0.4, c);
    osc('sine', 1000, t + 0.02, 0.08, 0.3, c);
    osc('sine', 1400, t + 0.05, 0.06, 0.2, c);
  }

  // 位置質問の回答：リール停止音×3（ドン！ドン！ドン！）
  function seAnswerPosition() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    [0, 0.18, 0.36].forEach((delay, i) => {
      // 各リール停止の重い打撃音
      noise(t + delay, 0.06, 0.4, c);
      osc('square', 120 + i * 30, t + delay, 0.12, 0.5, c);
      osc('sine', 440 + i * 110, t + delay + 0.03, 0.1, 0.4, c);
    });
    // 全停止後の上昇チャイム
    osc('sine', 880,  t + 0.55, 0.12, 0.4, c);
    osc('sine', 1320, t + 0.65, 0.12, 0.4, c);
    osc('sine', 1760, t + 0.75, 0.15, 0.4, c);
  }

  // 点数質問の回答YES：チェリー当選音（明るく華やか）
  function seAnswerDotsYes() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    // コイン投入感
    for (let i = 0; i < 5; i++) {
      osc('sine', 1200 + i * 150, t + i * 0.06, 0.1, 0.35, c);
    }
    osc('square', 880, t, 0.08, 0.25, c);
    osc('sine', 2200, t + 0.25, 0.15, 0.4, c);
  }

  // 点数質問の回答NO：ハズレ音（ブザー）
  function seAnswerDotsNo() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    // 不協和ブザー
    osc('sawtooth', 180, t, 0.18, 0.45, c);
    osc('sawtooth', 160, t, 0.18, 0.35, c);
    noise(t + 0.1, 0.1, 0.2, c);
  }

  // ゴットファイブ正解：大当たりジャックポット
  function seWin() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    // 導入ファンファーレ
    [[392,0],[523,0.1],[659,0.2],[784,0.3],[1047,0.45],[784,0.55],[1047,0.65]].forEach(([f,d]) => {
      osc('square',   f,     t+d,      0.18, 0.5, c);
      osc('sine',     f*1.5, t+d+0.01, 0.12, 0.3, c);
    });
    // コイン大量落下
    for (let i = 0; i < 20; i++) {
      osc('sine', 900 + Math.random()*600, t + 0.4 + i * 0.06, 0.07, 0.4, c);
    }
    // 低音ドラム連打
    for (let i = 0; i < 8; i++) {
      noise(t + 0.4 + i * 0.1, 0.05, 0.5, c);
      osc('sine', 60, t + 0.4 + i * 0.1, 0.08, 0.6, c);
    }
    // 締めの高音フラッシュ
    osc('sine', 2093, t + 1.3, 0.25, 0.5, c);
    osc('sine', 2637, t + 1.5, 0.25, 0.5, c);
  }

  // 脱落：ゲームオーバー（スロットのガックン落下音）
  function seEliminated() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    // 急降下ピッチ
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.6);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    o.connect(g); g.connect(seGain);
    o.start(t); o.stop(t + 0.7);
    // ブザー
    osc('square', 150, t + 0.15, 0.25, 0.4, c);
    osc('square', 120, t + 0.35, 0.3,  0.35, c);
    noise(t + 0.5, 0.2, 0.3, c);
  }

  // ========== 音量・ON/OFF制御 ==========
  function setVolume(val) {
    volumeLevel = Math.max(0, Math.min(1, val));
    if (masterGain) masterGain.gain.value = volumeLevel;
    localStorage.setItem('gf_volume', volumeLevel);
  }

  function setEnabled(val) {
    enabled = val;
    if (!enabled) {
      stopBgm();
    }
    localStorage.setItem('gf_audio_enabled', val ? '1' : '0');
  }

  function loadSettings() {
    const vol = parseFloat(localStorage.getItem('gf_volume'));
    if (!isNaN(vol)) volumeLevel = vol;
    const en = localStorage.getItem('gf_audio_enabled');
    if (en !== null) enabled = en === '1';
  }

  loadSettings();

  return {
    playBgm, stopBgm, preloadBgm,
    seFlipTile, seSelectTile,
    seAnswerPosition, seAnswerDotsYes, seAnswerDotsNo,
    seWin, seEliminated,
    setVolume, setEnabled,
    getEnabled: () => enabled,
    getVolume:  () => volumeLevel,
    resume: () => { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  };
})();
