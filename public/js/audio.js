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

  // AudioContextの遅延初期化（ユーザー操作後に生成）
  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volumeLevel;
      masterGain.connect(ctx.destination);

      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.45;
      bgmGain.connect(masterGain);

      seGain = ctx.createGain();
      seGain.gain.value = 1.0;
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

  // ========== 各SE ==========

  // タイル公開：カードを捲る音
  function seFlipTile() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    noise(t, 0.06, 0.18, c);
    osc('sine', 480, t, 0.12, 0.15, c);
    osc('sine', 380, t + 0.05, 0.1, 0.1, c);
  }

  // タイル選択：チップを置く音
  function seSelectTile() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('triangle', 880, t, 0.08, 0.25, c);
    osc('triangle', 660, t + 0.04, 0.06, 0.15, c);
    noise(t, 0.04, 0.08, c);
  }

  // 位置質問の回答：上昇チャイム（カジノ風）
  function seAnswerPosition() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      osc('sine', freq, t + i * 0.09, 0.18, 0.22, c);
      osc('triangle', freq * 2, t + i * 0.09, 0.06, 0.06, c);
    });
  }

  // 点数質問の回答YES：ポジティブなピン音
  function seAnswerDotsYes() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('sine', 880, t, 0.15, 0.28, c);
    osc('sine', 1108, t + 0.08, 0.12, 0.22, c);
    osc('triangle', 1760, t + 0.14, 0.1, 0.12, c);
  }

  // 点数質問の回答NO：短いネガティブ音
  function seAnswerDotsNo() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('sawtooth', 320, t, 0.1, 0.2, c);
    osc('sawtooth', 240, t + 0.07, 0.12, 0.18, c);
  }

  // ゴットファイブ正解：カジノファンファーレ
  function seWin() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    // 主旋律
    const melody = [
      [523, 0.00], [523, 0.12], [523, 0.24],
      [659, 0.36], [784, 0.52], [1047, 0.68],
      [784, 0.84], [1047, 1.00],
    ];
    melody.forEach(([freq, delay]) => {
      osc('sine', freq, t + delay, 0.22, 0.35, c);
      osc('triangle', freq * 1.5, t + delay, 0.12, 0.12, c);
    });
    // 低音ベース
    const bass = [[130, 0.00], [164, 0.36], [196, 0.68], [260, 1.00]];
    bass.forEach(([freq, delay]) => {
      osc('sawtooth', freq, t + delay, 0.3, 0.3, c);
    });
    // コイン音
    for (let i = 0; i < 8; i++) {
      osc('sine', 1200 + Math.random() * 400, t + 0.6 + i * 0.07, 0.08, 0.15, c);
    }
  }

  // 脱落：落下音
  function seEliminated() {
    if (!enabled) return;
    const c = getCtx();
    const t = c.currentTime;
    osc('sawtooth', 440, t, 0.1, 0.3, c);
    osc('sawtooth', 330, t + 0.1, 0.15, 0.25, c);
    osc('sawtooth', 220, t + 0.25, 0.2, 0.22, c);
    osc('sawtooth', 110, t + 0.45, 0.35, 0.18, c);
    noise(t + 0.3, 0.3, 0.12, c);
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
