const socket = io({ transports: ['websocket', 'polling'] });

// ========== オーディオ初期化（ゲーム画面）==========
function initGameAudio() {
  const toggle = document.getElementById('audioToggleBtn');
  const slider = document.getElementById('volumeSlider');

  slider.value = Math.round(AudioSystem.getVolume() * 100);
  updateAudioBtn(toggle, AudioSystem.getEnabled());

  toggle.addEventListener('click', () => {
    AudioSystem.resume();
    const next = !AudioSystem.getEnabled();
    AudioSystem.setEnabled(next);
    updateAudioBtn(toggle, next);
    if (next) AudioSystem.playBgm('/audio/bgm_game.mp3');
    else AudioSystem.stopBgm();
  });

  slider.addEventListener('input', () => {
    AudioSystem.resume();
    AudioSystem.setVolume(slider.value / 100);
    if (!AudioSystem.getEnabled()) {
      AudioSystem.setEnabled(true);
      updateAudioBtn(toggle, true);
      AudioSystem.playBgm('/audio/bgm_game.mp3');
    }
  });
}

function updateAudioBtn(btn, enabled) {
  btn.textContent = enabled ? '🔊' : '🔇';
  btn.classList.toggle('muted', !enabled);
}

// ページロード直後に先読み（ロビーで既にキャッシュ済みの場合は即座に再生できる）
AudioSystem.preloadBgm('/audio/bgm_game.mp3');
AudioSystem.preloadBgm('/audio/bgm_lobby.mp3');

// BGMはgame_state受信時に開始するため、clickハンドラは不要

initGameAudio();

let myId = sessionStorage.getItem('myId');
const roomCode = sessionStorage.getItem('roomCode');

if (!roomCode) { window.location.href = '/'; }

// ========== 状態管理 ==========
let gameState = null;
let selectedFaceUpTile = null; // 質問で選択中の表向きタイル
let pendingQuestion = null;    // 'position' | 'dots'

// ========== DOM参照 ==========
const turnBanner       = document.getElementById('turnBanner');
const faceDownArea     = document.getElementById('faceDownArea');
const faceUpArea       = document.getElementById('faceUpArea');
const allStands        = document.getElementById('allStands');
const actionPanel      = document.getElementById('actionPanel');
const stepFlip         = document.getElementById('stepFlip');
const stepQuestion     = document.getElementById('stepQuestion');
const questionChoice   = document.getElementById('questionChoice');
const dotsSlotSelect   = document.getElementById('dotsSlotSelect');
const slotButtons      = document.getElementById('slotButtons');
const btnPosition      = document.getElementById('btnPosition');
const btnDots          = document.getElementById('btnDots');
const btnCancelSelect  = document.getElementById('btnCancelSelect');
const btnCancelDots    = document.getElementById('btnCancelDots');
const turnLogEl        = document.getElementById('turnLog');
const gameOverModal    = document.getElementById('gameOverModal');
const gameOverTitle    = document.getElementById('gameOverTitle');
const gameOverMsg      = document.getElementById('gameOverMsg');
const revealedHands    = document.getElementById('revealedHands');
const backToLobbyBtn   = document.getElementById('backToLobbyBtn');
const retryBtn         = document.getElementById('retryBtn');
const retryWaitMsg     = document.getElementById('retryWaitMsg');
const confirmModal     = document.getElementById('confirmModal');
const confirmNumbers   = document.getElementById('confirmNumbers');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmOkBtn     = document.getElementById('confirmOkBtn');
const gottfiveBtn      = document.getElementById('gottfiveBtn');
const toast            = document.getElementById('toast');

// ========== カラー設定 ==========
const COLOR_JP = { red:'赤', blue:'青', green:'緑', orange:'橙', purple:'紫' };
const COLOR_CLASS = { red:'tile-red', blue:'tile-blue', green:'tile-green', orange:'tile-orange', purple:'tile-purple' };
const DOTS_SYMBOL = { 1:'•', 2:'••', 3:'•••' };

// ========== ゲームボード（メモシート）初期化 ==========
function initGameBoard() {
  const board = document.getElementById('gameBoard');
  board.innerHTML = '';

  // ヘッダー行
  const header = document.createElement('div');
  header.className = 'board-row board-header';
  header.innerHTML = '<div class="board-cell board-row-label"></div>';
  for (let col = 1; col <= 12; col++) {
    const c = document.createElement('div');
    c.className = 'board-cell board-col-label';
    c.textContent = col;
    header.appendChild(c);
  }
  board.appendChild(header);

  const colors = ['red','blue','green','orange','purple'];
  colors.forEach(color => {
    const row = document.createElement('div');
    row.className = 'board-row';

    const label = document.createElement('div');
    label.className = `board-cell board-row-label ${COLOR_CLASS[color]}`;
    label.textContent = COLOR_JP[color];
    row.appendChild(label);

    getNumbersForColor(color).forEach(num => {
      const cell = document.createElement('div');
      cell.className = `board-cell board-num-cell ${COLOR_CLASS[color]}`;
      cell.dataset.num = num;

      const dots = getDots(num);
      cell.innerHTML = `<span class="board-num">${num}</span><span class="board-dots">${DOTS_SYMBOL[dots]}</span>`;

      // 状態: 0=初期 1=× 2=△
      let cellState = getStoredCellState(num);
      applyCellState(cell, cellState);

      cell.addEventListener('click', () => {
        cellState = (cellState + 1) % 3;
        storeCellState(num, cellState);
        applyCellState(cell, cellState);
      });

      row.appendChild(cell);
    });

    board.appendChild(row);
  });
}

function applyCellState(cell, state) {
  cell.classList.remove('state-x','state-triangle');
  const overlay = cell.querySelector('.board-overlay');
  if (overlay) overlay.remove();
  if (state === 0) return;
  const symbols = { 1:'✖', 2:'△' };
  const classes  = { 1:'state-x', 2:'state-triangle' };
  cell.classList.add(classes[state]);
  const ov = document.createElement('span');
  ov.className = 'board-overlay';
  ov.textContent = symbols[state];
  cell.prepend(ov);
}

function getStoredCellState(num) {
  const key = `gf_board_${roomCode}_${myId}_${num}`;
  return parseInt(localStorage.getItem(key) || '0');
}

function storeCellState(num, state) {
  const key = `gf_board_${roomCode}_${myId}_${num}`;
  localStorage.setItem(key, state);
}

// ========== タイルHTML生成 ==========
function makeTileEl(tile, opts = {}) {
  const el = document.createElement('div');
  el.className = `tile ${COLOR_CLASS[tile.color] || ''}`;
  if (opts.faceDown) {
    el.classList.add('tile-facedown');
    el.innerHTML = `<span class="tile-color-label">${COLOR_JP[tile.color]}</span>`;
  } else {
    el.innerHTML = `
      <span class="tile-number">${tile.number}</span>
      <span class="tile-dots">${DOTS_SYMBOL[tile.dots] || ''}</span>
    `;
  }
  if (opts.hidden) {
    el.classList.add('tile-hidden');
    el.innerHTML = `<span class="tile-qmark">？</span>`;
  }
  if (opts.selected) el.classList.add('tile-selected');
  return el;
}

// ========== 場のタイル描画 ==========
function renderField(state) {
  const isMyTurn = isCurrentPlayer(state);
  const isFlipPhase = state.phase === 'flip';

  // 裏向き：色ごとに縦列で全枚数を色付きミニタイルで表示
  faceDownArea.innerHTML = '';
  const colorTilesMap = {};
  state.field.faceDown.forEach(t => {
    if (!colorTilesMap[t.color]) colorTilesMap[t.color] = [];
    colorTilesMap[t.color].push(t);
  });

  ['red','blue','green','orange','purple'].forEach(color => {
    const tiles = colorTilesMap[color] || [];
    const col = document.createElement('div');
    col.className = 'facedown-col';

    tiles.forEach(() => {
      const mini = document.createElement('div');
      mini.className = `fd-mini-tile ${COLOR_CLASS[color]}`;
      col.appendChild(mini);
    });

    const label = document.createElement('div');
    label.className = 'fd-col-label';
    label.textContent = tiles.length > 0 ? `${COLOR_JP[color]} ×${tiles.length}` : `${COLOR_JP[color]} 0`;
    col.appendChild(label);

    if (isMyTurn && isFlipPhase && tiles.length > 0) {
      col.classList.add('clickable');
      col.addEventListener('click', () => {
        socket.emit('flip_tile_color', { color });
      });
    }

    faceDownArea.appendChild(col);
  });

  // 表向き
  faceUpArea.innerHTML = '';
  const isQuestionPhase = state.phase === 'question';
  state.field.faceUp.forEach(tile => {
    const el = makeTileEl(tile);
    // 直前に公開されたタイルをハイライト
    if (tile.number === state.lastFlippedTileNumber) {
      el.classList.add('tile-newly-flipped');
    }
    if (isMyTurn && isQuestionPhase) {
      el.classList.add('clickable');
      if (selectedFaceUpTile && selectedFaceUpTile.number === tile.number) {
        el.classList.add('tile-selected');
      }
      el.addEventListener('click', () => {
        AudioSystem.seSelectTile();
        selectFaceUpTile(tile);
      });
    }
    faceUpArea.appendChild(el);
  });
}

// ========== スタンド描画 ==========
function renderStands(state) {
  allStands.innerHTML = '';
  // プレイヤー数に応じたレイアウトクラスを設定
  allStands.className = `all-stands layout-${state.players.length}`;
  state.players.forEach(player => {
    const isMe = player.id === myId;
    const standWrap = document.createElement('div');
    standWrap.className = `stand-wrap ${player.eliminated ? 'eliminated' : ''} ${isMe ? 'my-stand' : ''}`;

    const nameEl = document.createElement('div');
    nameEl.className = 'stand-name';
    nameEl.textContent = player.name + (isMe ? '（あなた）' : '') + (player.eliminated ? ' 【脱落】' : '');
    standWrap.appendChild(nameEl);

    const standEl = document.createElement('div');
    standEl.className = 'stand';

    // 全タイル（初期スロット＋差し込みタイル）を並べる
    // positionTilesをafterSlotでソートして組み合わせ
    const positions = buildStandLayout(player);

    positions.forEach((item, layoutIdx) => {
      if (item.type === 'slot') {
        const slot = item.slot;
        const slotWrap = document.createElement('div');
        slotWrap.className = 'slot-wrap';

        // 点数タイル（上部）
        if (slot.dotsTiles && slot.dotsTiles.length > 0) {
          const dotsStack = document.createElement('div');
          dotsStack.className = 'dots-stack';
          slot.dotsTiles.forEach(dt => {
            const dtEl = makeTileEl(dt.tile);
            dtEl.classList.add('dots-tile');
            dtEl.classList.add(dt.match ? 'dots-yes' : 'dots-no');
            const icon = document.createElement('span');
            icon.className = 'dots-result-icon';
            icon.textContent = dt.match ? '✓' : '✗';
            dtEl.appendChild(icon);
            dotsStack.appendChild(dtEl);
          });
          slotWrap.appendChild(dotsStack);
        }

        // 初期スロットタイル
        const tileEl = isMe
          ? makeTileEl(slot.tile, { hidden: true })
          : makeTileEl(slot.tile);
        tileEl.classList.add('initial-tile');
        slotWrap.appendChild(tileEl);

        standEl.appendChild(slotWrap);

      } else if (item.type === 'position') {
        // 差し込みタイル
        const ptEl = makeTileEl(item.tile);
        ptEl.classList.add('position-tile');
        standEl.appendChild(ptEl);
      }
    });

    standWrap.appendChild(standEl);
    allStands.appendChild(standWrap);
  });
}

// スタンドのレイアウト順序を組み立てる
function buildStandLayout(player) {
  const result = [];
  // afterSlot: -1=先頭前, 0=slot0後, 1=slot1後, ..., 4=slot4後
  const getPosBefore = (slotIdx) =>
    player.positionTiles.filter(pt => pt.afterSlot === slotIdx - 1);

  // 先頭（afterSlot=-1）の位置タイル
  getPosBefore(0).forEach(pt => result.push({ type:'position', tile: pt.tile }));

  player.slots.forEach((slot, i) => {
    result.push({ type:'slot', slot });
    getPosBefore(i + 1).forEach(pt => result.push({ type:'position', tile: pt.tile }));
  });

  return result;
}

// ========== 操作パネル ==========
function renderActionPanel(state) {
  const isMyTurn = isCurrentPlayer(state);
  actionPanel.classList.toggle('hidden', !isMyTurn || state.phase === 'declare_prompt');

  if (!isMyTurn) return;

  stepFlip.classList.toggle('hidden', state.phase !== 'flip');
  stepQuestion.classList.toggle('hidden', state.phase !== 'question');

  if (state.phase === 'question') {
    questionChoice.classList.toggle('hidden', !selectedFaceUpTile);
    dotsSlotSelect.classList.add('hidden');
  }
}

function selectFaceUpTile(tile) {
  selectedFaceUpTile = tile;
  questionChoice.classList.remove('hidden');
  renderField(gameState);
}

btnCancelSelect.addEventListener('click', () => {
  selectedFaceUpTile = null;
  questionChoice.classList.add('hidden');
  renderField(gameState);
});

btnPosition.addEventListener('click', () => {
  if (!selectedFaceUpTile) return;
  socket.emit('ask_position', { tileNumber: selectedFaceUpTile.number });
  selectedFaceUpTile = null;
  questionChoice.classList.add('hidden');
});

btnDots.addEventListener('click', () => {
  if (!selectedFaceUpTile) return;
  pendingQuestion = 'dots';
  questionChoice.classList.add('hidden');
  dotsSlotSelect.classList.remove('hidden');
  renderSlotButtons();
});

btnCancelDots.addEventListener('click', () => {
  pendingQuestion = null;
  dotsSlotSelect.classList.add('hidden');
  questionChoice.classList.remove('hidden');
});

function renderSlotButtons() {
  slotButtons.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-slot';
    btn.textContent = `スロット ${i + 1}`;
    btn.addEventListener('click', () => {
      socket.emit('ask_dots', { tileNumber: selectedFaceUpTile.number, slotIndex: i });
      selectedFaceUpTile = null;
      pendingQuestion = null;
      dotsSlotSelect.classList.add('hidden');
    });
    // SE はサーバーからの結果受信時に再生（YES/NO判定後）
    slotButtons.appendChild(btn);
  }
}

// ========== ターンバナー ==========
function renderTurnBanner(state) {
  const cp = state.players[state.currentPlayerIndex];
  if (!cp) return;
  const isMyTurn = cp.id === myId;
  turnBanner.textContent = isMyTurn ? '▶ あなたの手番です' : `▶ ${cp.name} の手番`;
  turnBanner.className = `turn-banner ${isMyTurn ? 'my-turn' : 'other-turn'}`;
}

// ========== ターンログ ==========
function renderTurnLog(state) {
  if (!state.turnLog) return;
  turnLogEl.innerHTML = '';
  [...state.turnLog].reverse().forEach(log => {
    const li = document.createElement('div');
    li.className = 'log-item';
    li.textContent = log;
    turnLogEl.appendChild(li);
  });
}

// ========== 全描画 ==========
function render(state) {
  renderTurnBanner(state);
  renderField(state);
  renderStands(state);
  renderActionPanel(state);
  renderTurnLog(state);
}

// ========== ゴットファイブ！宣言 ==========
gottfiveBtn.addEventListener('click', () => {
  const inputs = [0,1,2,3,4].map(i => parseInt(document.getElementById(`dec${i}`).value));
  if (inputs.some(isNaN)) {
    showToast('5つの数字をすべて入力してください。');
    return;
  }
  if (inputs.some(n => n < 1 || n > 60)) {
    showToast('数字は1〜60の範囲で入力してください。');
    return;
  }
  confirmNumbers.textContent = inputs.join('、');
  confirmModal.classList.remove('hidden');
});

confirmCancelBtn.addEventListener('click', () => {
  confirmModal.classList.add('hidden');
});

confirmOkBtn.addEventListener('click', () => {
  const numbers = [0,1,2,3,4].map(i => parseInt(document.getElementById(`dec${i}`).value));
  confirmModal.classList.add('hidden');
  socket.emit('declare_gottfive', { numbers });
});

// ========== Socket.io受信 ==========
socket.on('game_start', ({ state, myId: id }) => {
  if (id) sessionStorage.setItem('myId', id);
  gameState = state;
  initGameBoard();
  render(state);
});

socket.on('game_state', ({ state, myId: id }) => {
  if (id) {
    myId = id;
    sessionStorage.setItem('myId', id);
  }

  // 前回stateと比較してSEを判定
  if (gameState) {
    // タイル公開SE：表向きタイルが増えた
    if (state.field.faceUp.length > gameState.field.faceUp.length) {
      AudioSystem.seFlipTile();
    }

    // 位置質問SE：いずれかのプレイヤーのpositionTilesが増えた
    state.players.forEach(p => {
      const prev = gameState.players.find(pp => pp.id === p.id);
      if (prev && p.positionTiles.length > prev.positionTiles.length) {
        AudioSystem.seAnswerPosition();
      }
    });

    // 点数質問SE：いずれかのプレイヤーのdotsTileが増えた
    state.players.forEach(p => {
      const prev = gameState.players.find(pp => pp.id === p.id);
      if (!prev) return;
      p.slots.forEach((slot, i) => {
        const prevSlot = prev.slots[i];
        if (slot.dotsTiles.length > (prevSlot?.dotsTiles.length || 0)) {
          const newest = slot.dotsTiles[slot.dotsTiles.length - 1];
          if (newest.match) AudioSystem.seAnswerDotsYes();
          else AudioSystem.seAnswerDotsNo();
        }
      });
    });

    // 脱落SE：新たにeliminatedになったプレイヤーを検出
    state.players.forEach(p => {
      const prev = gameState.players.find(pp => pp.id === p.id);
      if (p.eliminated && prev && !prev.eliminated) {
        AudioSystem.seEliminated();
      }
    });
  }

  gameState = state;
  if (!document.getElementById('gameBoard').hasChildNodes()) {
    initGameBoard();
  }
  // 未再生の場合のみBGM開始（再生中は呼ばない＝AudioSystem内でガード済み）
  if (AudioSystem.getEnabled()) AudioSystem.playBgm('/audio/bgm_game.mp3');

  render(state);
});

socket.on('game_over', ({ winner, correct, state, isHost }) => {
  gameState = state;
  render(state);
  AudioSystem.stopBgm();
  if (winner) {
    AudioSystem.seWin();
  } else {
    AudioSystem.seEliminated();
  }

  gameOverModal.classList.remove('hidden');
  if (winner) {
    gameOverTitle.textContent = `${winner} がゴットファイブ！達成！`;
    gameOverMsg.textContent = `正解：${correct.join('、')}`;
  } else {
    gameOverTitle.textContent = '勝者なし';
    gameOverMsg.textContent = 'ノーゲームとなりました。';
  }

  // 全員の手札を公開表示
  revealedHands.innerHTML = '';
  state.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'revealed-player';
    const nums = p.slots.map(s => s.tile.number).join('、');
    div.textContent = `${p.name}：${nums}`;
    revealedHands.appendChild(div);
  });

  // ホスト判定によりリトライボタンを切り替え
  if (isHost) {
    retryBtn.classList.remove('hidden');
    retryWaitMsg.classList.add('hidden');
  } else {
    retryBtn.classList.add('hidden');
    retryWaitMsg.classList.remove('hidden');
  }
});

retryBtn.addEventListener('click', () => {
  socket.emit('retry_game');
});

socket.on('game_retry', () => {
  gameOverModal.classList.add('hidden');
  gameState = null;
  selectedFaceUpTile = null;
  pendingQuestion = null;
  // ゴットファイブ宣言欄をリセット
  [0,1,2,3,4].forEach(i => { document.getElementById(`dec${i}`).value = ''; });
  // ゲームボードのメモ（localStorage）をリセット
  Object.keys(localStorage)
    .filter(k => k.startsWith(`gf_board_${roomCode}_`))
    .forEach(k => localStorage.removeItem(k));
  document.getElementById('gameBoard').innerHTML = '';
  AudioSystem.playBgm('/audio/bgm_game.mp3');
});

socket.on('field_empty', ({ message }) => {
  showToast(message, 5000);
});

socket.on('error', ({ message }) => {
  showToast(message);
});

backToLobbyBtn.addEventListener('click', () => {
  sessionStorage.clear();
  window.location.href = '/';
});

// ========== ユーティリティ ==========
function isCurrentPlayer(state) {
  return state.players[state.currentPlayerIndex]?.id === myId;
}

function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

function getDots(n) {
  if ([1,2,3,4,5,16,17,18,19,20,31,32,33,34,35,46,47,48,49,50].includes(n)) return 1;
  if ([6,7,8,9,10,21,22,23,24,25,36,37,38,39,40,51,52,53,54,55].includes(n)) return 2;
  return 3;
}

function getNumbersForColor(color) {
  const map = {
    red:    [1,6,11,16,21,26,31,36,41,46,51,56],
    blue:   [2,7,12,17,22,27,32,37,42,47,52,57],
    green:  [3,8,13,18,23,28,33,38,43,48,53,58],
    orange: [4,9,14,19,24,29,34,39,44,49,54,59],
    purple: [5,10,15,20,25,30,35,40,45,50,55,60],
  };
  return map[color] || [];
}

// 初期化・再接続時に常にルームへ再参加
const playerName = sessionStorage.getItem('playerName');

function doRejoin() {
  if (roomCode && playerName) {
    socket.emit('rejoin_game', { roomCode, playerName });
  }
}

socket.on('connect', () => {
  doRejoin();
});

// 初回接続でgame_stateが届かなかった場合のリトライ（2秒・5秒後）
setTimeout(() => { if (!gameState) doRejoin(); }, 2000);
setTimeout(() => { if (!gameState) doRejoin(); }, 5000);
