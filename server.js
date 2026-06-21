const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

app.use(express.static('public'));

// ========== タイル定義 ==========
const COLOR_NUMBERS = {
  red:    [1,6,11,16,21,26,31,36,41,46,51,56],
  blue:   [2,7,12,17,22,27,32,37,42,47,52,57],
  green:  [3,8,13,18,23,28,33,38,43,48,53,58],
  orange: [4,9,14,19,24,29,34,39,44,49,54,59],
  purple: [5,10,15,20,25,30,35,40,45,50,55,60],
};

const COLORS = ['red', 'blue', 'green', 'orange', 'purple'];
const COLOR_JP = { red:'赤', blue:'青', green:'緑', orange:'橙', purple:'紫' };

function getDots(n) {
  if ([1,2,3,4,5,16,17,18,19,20,31,32,33,34,35,46,47,48,49,50].includes(n)) return 1;
  if ([6,7,8,9,10,21,22,23,24,25,36,37,38,39,40,51,52,53,54,55].includes(n)) return 2;
  return 3;
}

function getColor(n) {
  for (const [color, nums] of Object.entries(COLOR_NUMBERS)) {
    if (nums.includes(n)) return color;
  }
  return null;
}

function makeTile(n) {
  return { number: n, color: getColor(n), dots: getDots(n) };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========== ルーム管理 ==========
const rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

function createGameState(players) {
  // 全60枚のタイルを生成
  const allTiles = [];
  for (let n = 1; n <= 60; n++) allTiles.push(makeTile(n));

  // 色ごとにシャッフル
  const fieldByColor = {};
  for (const color of COLORS) {
    fieldByColor[color] = shuffle(COLOR_NUMBERS[color].map(n => makeTile(n)));
  }

  // 各プレイヤーに5色1枚ずつランダムに配布
  const playerHands = players.map(() => {
    const hand = {};
    for (const color of COLORS) {
      hand[color] = fieldByColor[color].pop();
    }
    return hand;
  });

  // 場の裏向きタイル（残り）をフラットな配列に
  const faceDownTiles = [];
  for (const color of COLORS) {
    for (const tile of fieldByColor[color]) {
      faceDownTiles.push({ ...tile, id: `fd_${tile.number}` });
    }
  }

  // 場の初期公開タイル：5色各1枚をランダム選出
  const faceUpTiles = [];
  const faceDownRemaining = [...faceDownTiles];
  for (const color of COLORS) {
    const colorTiles = faceDownRemaining.filter(t => t.color === color);
    if (colorTiles.length > 0) {
      const chosen = colorTiles[Math.floor(Math.random() * colorTiles.length)];
      faceUpTiles.push({ ...chosen, id: `fu_${chosen.number}` });
      const idx = faceDownRemaining.findIndex(t => t.number === chosen.number);
      faceDownRemaining.splice(idx, 1);
    }
  }

  // プレイヤーの手札を昇順ソートしてスロット化
  const playerStates = players.map((p, i) => {
    const handTiles = Object.values(playerHands[i]).sort((a, b) => a.number - b.number);
    return {
      id: p.id,
      name: p.name,
      eliminated: false,
      // 初期5枚スロット（インデックス0〜4）
      slots: handTiles.map((tile, si) => ({
        slotIndex: si,
        tile: tile,
        // 上部に配置された点数タイル
        dotsTiles: [],
      })),
      // 位置タイル（スロット間に挿入）: { afterSlot: -1〜3, tile, id }
      // afterSlot: -1 = 先頭より前, 0 = slot0の後, ..., 4 = slot4の後
      positionTiles: [],
    };
  });

  return {
    players: playerStates,
    field: {
      faceDown: faceDownRemaining,
      faceUp: faceUpTiles,
    },
    currentPlayerIndex: 0,
    phase: 'flip', // 'flip' | 'question' | 'declare_prompt'
    status: 'playing',
    turnLog: [],
  };
}

// ゲームステートから送信用データを生成（プレイヤーIDに応じて自分の手札番号を隠す）
function getStateForPlayer(state, playerId) {
  return {
    ...state,
    players: state.players.map(p => ({
      ...p,
      slots: p.slots.map(s => ({
        ...s,
        tile: p.id === playerId
          ? { ...s.tile, number: null, dots: null } // 自分の初期タイルは数字・点数を隠す
          : s.tile,
      })),
    })),
  };
}

// ========== Socket.io ==========
io.on('connection', (socket) => {

  // ルーム作成
  socket.on('create_room', ({ name }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name, ready: false }],
      gameState: null,
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    socket.emit('room_created', { code });
    io.to(code).emit('room_update', { players: rooms[code].players, code });
  });

  // ルーム参加
  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }
    if (room.gameState) {
      socket.emit('error', { message: 'すでにゲームが始まっています。' });
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('error', { message: 'ルームが満員です。' });
      return;
    }
    room.players.push({ id: socket.id, name, ready: false });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    socket.emit('room_joined', { code });
    io.to(code).emit('room_update', { players: room.players, code });
  });

  // ゲーム開始（ホストのみ）
  socket.on('start_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit('error', { message: '2人以上必要です。' });
      return;
    }
    room.gameState = createGameState(room.players);
    // 各プレイヤーに個別のステートを送信
    for (const p of room.players) {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) {
        playerSocket.emit('game_start', {
          state: getStateForPlayer(room.gameState, p.id),
          myId: p.id,
        });
      }
    }
  });

  // 裏向きタイルを公開
  // 質問A：位置を示してもらう
  socket.on('ask_position', ({ tileNumber }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) return;
    if (state.phase !== 'question') return;

    const faceUpIdx = state.field.faceUp.findIndex(t => t.number === tileNumber);
    if (faceUpIdx === -1) return;

    const [tile] = state.field.faceUp.splice(faceUpIdx, 1);

    // 初期5スロットのどの位置に入るか計算
    const slotNumbers = currentPlayer.slots.map(s => s.tile.number);
    let afterSlot = -1; // -1: 先頭より前
    for (let i = 0; i < slotNumbers.length; i++) {
      if (tile.number > slotNumbers[i]) afterSlot = i;
    }

    currentPlayer.positionTiles.push({
      id: `pt_${tile.number}`,
      afterSlot,
      tile,
    });

    state.turnLog.push(`${currentPlayer.name} が ${tile.number} の位置を確認 → スロット${afterSlot}の後`);
    advanceTurn(state, room);
    broadcastState(room);
  });

  // 質問B：点の数を聞く
  socket.on('ask_dots', ({ tileNumber, slotIndex }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) return;
    if (state.phase !== 'question') return;

    const faceUpIdx = state.field.faceUp.findIndex(t => t.number === tileNumber);
    if (faceUpIdx === -1) return;
    if (slotIndex < 0 || slotIndex > 4) return;

    const [tile] = state.field.faceUp.splice(faceUpIdx, 1);
    const targetSlot = currentPlayer.slots[slotIndex];
    const match = tile.dots === targetSlot.tile.dots;

    targetSlot.dotsTiles.push({
      id: `dt_${tile.number}`,
      tile,
      match,
    });

    state.turnLog.push(`${currentPlayer.name} が ${tile.number}(点${tile.dots}) とスロット${slotIndex}の点数を比較 → ${match ? 'YES' : 'NO'}`);
    advanceTurn(state, room);
    broadcastState(room);
  });

  // ゴットファイブ！宣言
  socket.on('declare_gottfive', ({ numbers }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.gameState) return;
    const state = room.gameState;

    const declaringPlayer = state.players.find(p => p.id === socket.id);
    if (!declaringPlayer || declaringPlayer.eliminated) return;

    const correct = declaringPlayer.slots.map(s => s.tile.number).sort((a, b) => a - b);
    const answer = [...numbers].sort((a, b) => a - b);
    const isCorrect = correct.length === answer.length && correct.every((v, i) => v === answer[i]);

    if (isCorrect) {
      state.status = 'ended';
      broadcastGameOver(room, { winner: declaringPlayer.name, correct, state: revealFullState(state) });
    } else {
      declaringPlayer.eliminated = true;
      state.turnLog.push(`${declaringPlayer.name} が宣言したが不正解！脱落。`);

      // 手番が脱落したプレイヤーなら次へ
      if (state.players[state.currentPlayerIndex].id === socket.id) {
        advanceTurn(state, room);
      }

      // 残りプレイヤー確認
      const active = state.players.filter(p => !p.eliminated);
      if (active.length === 0) {
        state.status = 'ended';
        broadcastGameOver(room, { winner: null, correct: null, state: revealFullState(state) });
        return;
      }

      // 場のタイルが枯渇し全員宣言不能なら促す
      if (state.field.faceDown.length === 0 && state.field.faceUp.length === 0) {
        io.to(code).emit('field_empty', { message: '場のタイルがなくなりました。残りのプレイヤーはゴットファイブ！を宣言してください。' });
      }

      broadcastState(room);
    }
  });

  // 色指定で裏向きタイルを公開
  socket.on('flip_tile_color', ({ color }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) return;
    if (state.phase !== 'flip') return;

    const tilesOfColor = state.field.faceDown.filter(t => t.color === color);
    if (tilesOfColor.length === 0) return;

    const tile = tilesOfColor[Math.floor(Math.random() * tilesOfColor.length)];
    const idx = state.field.faceDown.findIndex(t => t.number === tile.number);
    state.field.faceDown.splice(idx, 1);
    tile.id = `fu_${tile.number}`;
    state.field.faceUp.push(tile);
    state.phase = 'question';

    state.turnLog.push(`${currentPlayer.name} が ${COLOR_JP[color]}の${tile.number}(点${tile.dots}) を公開`);
    broadcastState(room);
  });

  // ゲーム画面ロード時にルームへ再参加して最新ステートを返す
  socket.on('rejoin_game', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) { console.log(`rejoin_game: room ${roomCode} not found`); return; }
    if (!room.gameState) { console.log(`rejoin_game: game not started in room ${roomCode}`); return; }

    // 同名プレイヤーのIDを新しいsocket.idに更新
    const player = room.gameState.players.find(p => p.name === playerName);
    if (!player) { console.log(`rejoin_game: player ${playerName} not found`); return; }

    const oldId = player.id;
    player.id = socket.id;

    // roomのplayers一覧も更新
    const rp = room.players.find(p => p.name === playerName);
    if (rp) rp.id = socket.id;

    // ホストだった場合も更新
    if (room.host === oldId) room.host = socket.id;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.name = playerName;

    socket.emit('game_state', {
      state: getStateForPlayer(room.gameState, socket.id),
      myId: socket.id,
    });
  });

  // リトライ（ホストのみ）
  socket.on('retry_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;

    // 同じメンバーで新しいゲームステートを生成
    room.gameState = createGameState(room.players);

    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.id);
      if (s) {
        s.emit('game_retry');
        s.emit('game_state', {
          state: getStateForPlayer(room.gameState, p.id),
          myId: p.id,
        });
      }
    }
  });

  // 切断
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];

    if (!room.gameState) {
      // ゲーム前なら退室
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[code];
        return;
      }
      if (room.host === socket.id) {
        room.host = room.players[0].id;
      }
      io.to(code).emit('room_update', { players: room.players, code });
    }
    // ゲーム中の切断は再接続を待つ（即脱落にしない）
    // 意図的な脱落は declare_gottfive の不正解のみ
  });
});

// ターンを次の非脱落プレイヤーへ進める
function advanceTurn(state, room) {
  state.phase = 'flip';
  const total = state.players.length;
  let next = (state.currentPlayerIndex + 1) % total;
  let tries = 0;
  while (state.players[next].eliminated && tries < total) {
    next = (next + 1) % total;
    tries++;
  }

  // 場の裏向きタイルが0かつ表向きも0 → 宣言促しフェーズ
  if (state.field.faceDown.length === 0 && state.field.faceUp.length === 0) {
    state.phase = 'declare_prompt';
  }

  state.currentPlayerIndex = next;
}

// game_over をホストフラグ付きで個別送信
function broadcastGameOver(room, payload) {
  for (const p of room.players) {
    const s = io.sockets.sockets.get(p.id);
    if (s) {
      s.emit('game_over', { ...payload, isHost: room.host === p.id });
    }
  }
}

// 全プレイヤーに個別ステートをブロードキャスト
function broadcastState(room) {
  for (const p of room.players) {
    const playerSocket = io.sockets.sockets.get(p.id);
    if (playerSocket) {
      playerSocket.emit('game_state', {
        state: getStateForPlayer(room.gameState, p.id),
        myId: p.id,
      });
    }
  }
}

// 全タイルを公開したステート（ゲーム終了時）
function revealFullState(state) {
  return {
    ...state,
    players: state.players.map(p => ({
      ...p,
      slots: p.slots.map(s => ({ ...s })),
    })),
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ゴットファイブ！サーバー起動中 → http://localhost:${PORT}`);
});
