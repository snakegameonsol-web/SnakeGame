(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const paceEl = document.getElementById('pace');
  const overlay = document.getElementById('overlay');
  const overlayIcon = document.getElementById('overlayIcon');
  const overlayKicker = document.getElementById('overlayKicker');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const playerNameInput = document.getElementById('playerName');
  const saveNameBtn = document.getElementById('saveNameBtn');
  const scoreSubmitStatus = document.getElementById('scoreSubmitStatus');
  const leaderboardList = document.getElementById('leaderboardList');
  const refreshLeaderboardBtn = document.getElementById('refreshLeaderboardBtn');

  // Public API URL for the Render backend. Never put Supabase secret keys here.
  const API_BASE = 'https://snake-gmae-api.onrender.com';

  const CELLS = 25;
  const CELL = canvas.width / CELLS;
  const STORAGE_KEY = 'snakeLabBestV1';
  const DIRECTIONS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };

  let snake, direction, nextDirection, food, score, best, state, timer, lastTick;
  let touchStart = null;
  let animationFrame = null;
  let gameSessionId = null;
  let sessionStarting = false;

  function readBest() {
    try { return Math.max(0, Number(localStorage.getItem(STORAGE_KEY)) || 0); }
    catch { return 0; }
  }

  function formatScore(value) { return String(value).padStart(3, '0'); }

  function getPlayerName() {
    const name = (playerNameInput.value || '').trim();
    return name;
  }

  function setScoreStatus(message, kind = '') {
    scoreSubmitStatus.textContent = message;
    scoreSubmitStatus.classList.remove('status-error', 'status-success');
    if (kind) scoreSubmitStatus.classList.add(kind === 'error' ? 'status-error' : 'status-success');
  }

  function savePlayerName() {
    const name = getPlayerName();
    if (name.length < 2 || name.length > 20) {
      setScoreStatus('Name must be 2–20 characters.', 'error');
      playerNameInput.focus();
      return false;
    }
    try { localStorage.setItem('snakeLabPlayerNameV1', name); } catch { /* storage may be blocked */ }
    setScoreStatus(`Name saved as ${name}.`);
    return true;
  }

  async function submitScore(finalScore, sessionId = gameSessionId) {
    if (!Number.isInteger(finalScore) || finalScore < 1) {
      setScoreStatus('No points to submit this run.');
      return;
    }
    if (!sessionId) {
      setScoreStatus('This run has no valid server session. Start a new game and try again.', 'error');
      return;
    }
    if (!savePlayerName()) return;
    const displayName = getPlayerName();
    setScoreStatus('Checking and submitting your score…');
    try {
      const response = await fetch(`${API_BASE}/api/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: sessionId, display_name: displayName, score: finalScore })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = result.error || result.message || `Server returned ${response.status}`;
        throw new Error(message);
      }
      if (gameSessionId === sessionId) gameSessionId = null;
      setScoreStatus(`Score ${finalScore} verified and submitted!`, 'success');
      await loadLeaderboard();
    } catch (error) {
      setScoreStatus(`Score was not accepted: ${error.message}.`, 'error');
    }
  }

  async function createGameSession() {
    const response = await fetch(`${API_BASE}/api/games/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.game_id !== 'string') {
      throw new Error(result.error || `Server returned ${response.status}`);
    }
    return result.game_id;
  }

  async function loadLeaderboard() {
    leaderboardList.replaceChildren();
    const loading = document.createElement('li');
    loading.className = 'leaderboard-empty';
    loading.textContent = 'Loading scores…';
    leaderboardList.appendChild(loading);
    try {
      const response = await fetch(`${API_BASE}/api/leaderboard`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
      const rows = Array.isArray(result) ? result :
        Array.isArray(result.scores) ? result.scores :
        Array.isArray(result.leaderboard) ? result.leaderboard :
        Array.isArray(result.data) ? result.data : [];
      leaderboardList.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement('li');
        empty.className = 'leaderboard-empty';
        empty.textContent = 'No scores yet. Be the first!';
        leaderboardList.appendChild(empty);
        return;
      }
      rows.slice(0, 20).forEach((entry, index) => {
        const item = document.createElement('li');
        item.className = 'leaderboard-item';
        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        rank.textContent = String(index + 1).padStart(2, '0');
        const name = document.createElement('span');
        name.className = 'leaderboard-name';
        name.textContent = String(entry.display_name || 'Player');
        const scoreValue = document.createElement('strong');
        scoreValue.className = 'leaderboard-score';
        scoreValue.textContent = String(Number(entry.score) || 0);
        item.append(rank, name, scoreValue);
        leaderboardList.appendChild(item);
      });
    } catch (error) {
      leaderboardList.replaceChildren();
      const item = document.createElement('li');
      item.className = 'leaderboard-empty';
      item.textContent = 'Leaderboard unavailable. Check your connection and refresh.';
      leaderboardList.appendChild(item);
      console.error('Leaderboard error:', error);
    }
  }

  function setOverlay(mode) {
    overlay.classList.remove('hidden');
    if (mode === 'ready') {
      overlayIcon.textContent = '▶';
      overlayKicker.textContent = 'READY WHEN YOU ARE';
      overlayTitle.textContent = "Let's play.";
      overlayText.textContent = "Collect the glowing fruit. Don't hit the walls or yourself.";
      startBtn.innerHTML = 'Start game <span>↗</span>';
    } else if (mode === 'over') {
      overlayIcon.textContent = '↻';
      overlayKicker.textContent = 'GAME OVER';
      overlayTitle.textContent = score > 0 ? 'Nice run.' : 'Try again.';
      overlayText.textContent = `You scored ${score} point${score === 1 ? '' : 's'}. One more round?`;
      startBtn.innerHTML = 'Play again <span>↗</span>';
    } else if (mode === 'paused') {
      overlayIcon.textContent = 'Ⅱ';
      overlayKicker.textContent = 'TAKE YOUR TIME';
      overlayTitle.textContent = 'Paused.';
      overlayText.textContent = 'Your run is waiting right here.';
      startBtn.innerHTML = 'Resume game <span>↗</span>';
    }
  }

  function hideOverlay() { overlay.classList.add('hidden'); }

  function updateStats() {
    scoreEl.textContent = formatScore(score);
    bestEl.textContent = formatScore(best);
    const level = Math.floor(score / 50);
    paceEl.textContent = level === 0 ? 'CALM' : level === 1 ? 'QUICK' : level === 2 ? 'FAST' : 'WILD';
  }

  function resetGame(shouldStart = false) {
    clearTimeout(timer);
    gameSessionId = null;
    snake = [
      { x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 },
      { x: 9, y: 12 }
    ];
    direction = DIRECTIONS.right;
    nextDirection = DIRECTIONS.right;
    score = 0;
    best = readBest();
    food = makeFood();
    state = 'ready';
    lastTick = 0;
    updateStats();
    pauseBtn.disabled = true;
    pauseBtn.innerHTML = 'Ⅱ <span>Pause</span>';
    setOverlay('ready');
    draw();
    if (shouldStart) startGame();
  }

  function makeFood() {
    const available = [];
    for (let y = 0; y < CELLS; y++) {
      for (let x = 0; x < CELLS; x++) {
        if (!snake.some(part => part.x === x && part.y === y)) available.push({ x, y });
      }
    }
    if (!available.length) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  async function startGame() {
    if (state === 'paused') {
      state = 'running';
      hideOverlay();
      pauseBtn.innerHTML = 'Ⅱ <span>Pause</span>';
      pauseBtn.disabled = false;
      scheduleTick();
      return;
    }
    if (sessionStarting || state === 'running') return;
    if (state === 'over' || state === 'won') resetGame(false);

    sessionStarting = true;
    startBtn.disabled = true;
    setScoreStatus('Preparing a verified game session…');
    try {
      gameSessionId = await createGameSession();
      state = 'running';
      hideOverlay();
      pauseBtn.disabled = false;
      pauseBtn.innerHTML = 'Ⅱ <span>Pause</span>';
      lastTick = 0;
      scheduleTick();
    } catch (error) {
      gameSessionId = null;
      state = 'ready';
      setOverlay('ready');
      setScoreStatus(`Could not start a verified game: ${error.message}. Check your connection and try again.`, 'error');
    } finally {
      sessionStarting = false;
      startBtn.disabled = false;
    }
  }

  function pauseGame() {
    if (state !== 'running') return;
    state = 'paused';
    clearTimeout(timer);
    pauseBtn.innerHTML = '▶ <span>Resume</span>';
    setOverlay('paused');
  }

  function togglePause() {
    if (state === 'running') pauseGame();
    else if (state === 'paused') startGame();
  }

  function scheduleTick() {
    clearTimeout(timer);
    if (state !== 'running') return;
    const delay = Math.max(70, 145 - Math.floor(score / 30) * 8);
    timer = setTimeout(tick, delay);
  }

  function tick() {
    if (state !== 'running') return;
    direction = nextDirection;
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
    const ate = food && head.x === food.x && head.y === food.y;
    const bodyToCheck = ate ? snake : snake.slice(0, -1);
    const hitWall = head.x < 0 || head.y < 0 || head.x >= CELLS || head.y >= CELLS;
    const hitSelf = bodyToCheck.some(part => part.x === head.x && part.y === head.y);

    if (hitWall || hitSelf) {
      endGame();
      return;
    }

    snake.unshift(head);
    if (ate) {
      score += 10;
      if (score > best) {
        best = score;
        try { localStorage.setItem(STORAGE_KEY, String(best)); } catch { /* storage may be blocked */ }
      }
      food = makeFood();
      if (!food) {
        state = 'won';
        setOverlay('over');
      }
    } else {
      snake.pop();
    }
    updateStats();
    draw();
    if (state === 'running') scheduleTick();
  }

  function endGame() {
    state = 'over';
    clearTimeout(timer);
    pauseBtn.disabled = true;
    setOverlay('over');
    draw();
    if (score > 0) submitScore(score, gameSessionId);
    else setScoreStatus('Score 0 was not submitted. Play again to earn points.');
  }

  function setDirection(name) {
    const candidate = DIRECTIONS[name];
    if (!candidate) return;
    if (candidate.x === -direction.x && candidate.y === -direction.y) return;
    nextDirection = candidate;
    if (state === 'ready') startGame();
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawBackground() {
    ctx.fillStyle = '#0b1324';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(128, 151, 190, 0.075)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= CELLS; i++) {
      const p = i * CELL + 0.5;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(canvas.width, p); ctx.stroke();
    }
  }

  function drawFood() {
    if (!food) return;
    const cx = food.x * CELL + CELL / 2;
    const cy = food.y * CELL + CELL / 2;
    ctx.save();
    ctx.shadowColor = '#ff7b8b';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#ff6f85';
    ctx.beginPath(); ctx.arc(cx, cy, CELL * .29, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd0d5';
    ctx.beginPath(); ctx.arc(cx - CELL * .09, cy - CELL * .1, CELL * .07, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a6ed4c'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx + 1, cy - CELL * .23); ctx.quadraticCurveTo(cx + 2, cy - CELL * .42, cx + CELL * .17, cy - CELL * .4); ctx.stroke();
    ctx.restore();
  }

  function drawSnake() {
    snake.forEach((part, index) => {
      const inset = index === 0 ? 2 : 2.8;
      const x = part.x * CELL + inset;
      const y = part.y * CELL + inset;
      const size = CELL - inset * 2;
      const ratio = Math.max(.5, 1 - index / Math.max(snake.length * 1.5, 1));
      ctx.save();
      if (index === 0) { ctx.shadowColor = '#baff58'; ctx.shadowBlur = 13; }
      ctx.fillStyle = index === 0 ? '#d6ff86' : `rgb(${Math.round(146 + ratio * 40)}, ${Math.round(218 + ratio * 20)}, ${Math.round(62 + ratio * 12)})`;
      roundedRect(x, y, size, size, index === 0 ? 7 : 5);
      ctx.fill();
      ctx.restore();
      if (index === 0) drawEyes(part);
    });
  }

  function drawEyes(head) {
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    const offset = CELL * .16;
    let eyes;
    if (direction.x === 1) eyes = [{ x: cx + offset, y: cy - offset }, { x: cx + offset, y: cy + offset }];
    else if (direction.x === -1) eyes = [{ x: cx - offset, y: cy - offset }, { x: cx - offset, y: cy + offset }];
    else if (direction.y === -1) eyes = [{ x: cx - offset, y: cy - offset }, { x: cx + offset, y: cy - offset }];
    else eyes = [{ x: cx - offset, y: cy + offset }, { x: cx + offset, y: cy + offset }];
    ctx.fillStyle = '#172237';
    eyes.forEach(eye => { ctx.beginPath(); ctx.arc(eye.x, eye.y, 2.1, 0, Math.PI * 2); ctx.fill(); });
  }

  function draw() {
    drawBackground();
    drawFood();
    drawSnake();
    if (state === 'over') {
      ctx.fillStyle = 'rgba(255, 95, 121, .12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    const keyMap = {
      arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
      arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right'
    };
    if (keyMap[key]) {
      event.preventDefault();
      setDirection(keyMap[key]);
    } else if (key === ' ' || key === 'escape') {
      event.preventDefault();
      if (state === 'ready' || state === 'over') startGame(); else togglePause();
    }
  });

  document.querySelectorAll('[data-dir]').forEach(button => {
    button.addEventListener('click', () => setDirection(button.dataset.dir));
  });
  startBtn.addEventListener('click', startGame);
  pauseBtn.addEventListener('click', togglePause);
  restartBtn.addEventListener('click', () => { resetGame(false); startGame(); });
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);

  async function toggleFullscreen() {
    const gameColumn = document.querySelector('.game-column');
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (gameColumn && gameColumn.requestFullscreen) {
        await gameColumn.requestFullscreen();
      } else {
        setScoreStatus('Fullscreen is not supported by this browser.');
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
      setScoreStatus('Could not enter fullscreen. Try using your browser menu.');
    }
  }

  function updateFullscreenButton() {
    const isFullscreen = Boolean(document.fullscreenElement);
    fullscreenBtn.innerHTML = isFullscreen ? '⛶ <span>Exit full screen</span>' : '⛶ <span>Full screen</span>';
    fullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  }
  saveNameBtn.addEventListener('click', savePlayerName);
  refreshLeaderboardBtn.addEventListener('click', loadLeaderboard);
  playerNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') savePlayerName();
  });

  canvas.addEventListener('pointerdown', event => {
    touchStart = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', event => {
    if (!touchStart) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    if (Math.abs(dx) > Math.abs(dy)) setDirection(dx > 0 ? 'right' : 'left');
    else setDirection(dy > 0 ? 'down' : 'up');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'running') pauseGame();
  });

  try {
    const savedName = localStorage.getItem('snakeLabPlayerNameV1');
    if (savedName) playerNameInput.value = savedName;
  } catch { /* storage may be blocked */ }
  best = readBest();
  resetGame(false);
  loadLeaderboard();
})();
