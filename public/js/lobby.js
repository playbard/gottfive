const socket = io({ transports: ['websocket', 'polling'] });

// ========== オーディオ初期化（ロビー）==========
function initLobbyAudio() {
  const toggle = document.getElementById('lobbyAudioToggle');
  const slider = document.getElementById('lobbyVolumeSlider');

  slider.value = Math.round(AudioSystem.getVolume() * 100);
  updateToggleBtn(toggle, AudioSystem.getEnabled());

  toggle.addEventListener('click', () => {
    AudioSystem.resume();
    const next = !AudioSystem.getEnabled();
    AudioSystem.setEnabled(next);
    updateToggleBtn(toggle, next);
    if (next) AudioSystem.playBgm('/audio/bgm_lobby.mp3');
    else AudioSystem.stopBgm();
  });

  slider.addEventListener('input', () => {
    AudioSystem.resume();
    AudioSystem.setVolume(slider.value / 100);
    if (!AudioSystem.getEnabled()) {
      AudioSystem.setEnabled(true);
      updateToggleBtn(toggle, true);
    }
  });
}

function updateToggleBtn(btn, enabled) {
  btn.textContent = enabled ? '🔊' : '🔇';
  btn.classList.toggle('muted', !enabled);
}

// ページロード直後にBGMを先読み（ユーザー操作前でもfetch可能）
AudioSystem.preloadBgm('/audio/bgm_lobby.mp3');
AudioSystem.preloadBgm('/audio/bgm_game.mp3'); // ゲーム画面用も先読み

// 最初のユーザー操作でBGM開始（AudioContextはユーザー操作後に解放される）
document.addEventListener('click', () => {
  if (AudioSystem.getEnabled()) {
    AudioSystem.playBgm('/audio/bgm_lobby.mp3');
  }
}, { once: true });

initLobbyAudio();

const playerNameInput = document.getElementById('playerName');
const roomCodeInput   = document.getElementById('roomCodeInput');
const createRoomBtn   = document.getElementById('createRoomBtn');
const joinRoomBtn     = document.getElementById('joinRoomBtn');
const waitingRoom     = document.getElementById('waitingRoom');
const displayCode     = document.getElementById('displayCode');
const copyCodeBtn     = document.getElementById('copyCodeBtn');
const playerList      = document.getElementById('playerList');
const startGameBtn    = document.getElementById('startGameBtn');
const waitingMsg      = document.getElementById('waitingMsg');
const errorMsg        = document.getElementById('errorMsg');

let isHost = false;
let myRoomCode = null;

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  setTimeout(() => errorMsg.classList.add('hidden'), 4000);
}

function getName() {
  const name = playerNameInput.value.trim();
  if (!name) { showError('プレイヤー名を入力してください。'); return null; }
  return name;
}

createRoomBtn.addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  isHost = true;
  socket.emit('create_room', { name });
});

joinRoomBtn.addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  const code = roomCodeInput.value.trim();
  if (code.length !== 4) { showError('4桁のルームコードを入力してください。'); return; }
  socket.emit('join_room', { name, code });
});

copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(myRoomCode).then(() => {
    copyCodeBtn.textContent = 'コピー完了！';
    setTimeout(() => copyCodeBtn.textContent = 'コピー', 2000);
  });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('start_game');
});

socket.on('room_created', ({ code }) => {
  myRoomCode = code;
  displayCode.textContent = code;
  waitingRoom.classList.remove('hidden');
  startGameBtn.classList.remove('hidden');
  waitingMsg.classList.add('hidden');
});

socket.on('room_joined', ({ code }) => {
  myRoomCode = code;
  displayCode.textContent = code;
  waitingRoom.classList.remove('hidden');
});

socket.on('room_update', ({ players }) => {
  playerList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('div');
    li.className = 'player-item';
    li.textContent = p.name;
    playerList.appendChild(li);
  });
});

socket.on('game_start', ({ state, myId }) => {
  sessionStorage.setItem('myId', myId);
  sessionStorage.setItem('roomCode', myRoomCode);
  sessionStorage.setItem('playerName', playerNameInput.value.trim());
  window.location.href = '/game.html';
});

socket.on('error', ({ message }) => {
  showError(message);
});
