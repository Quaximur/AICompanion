const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { PORT, HOST, STATES } = require('./shared/protocol');
const { isPrimaryButtonDown } = require('./mouse');

const WINDOW_WIDTH = 440;
const WINDOW_HEIGHT = 560;
const SCREEN_MARGIN = 12;
const MAX_BODY_BYTES = 256 * 1024;
const HOVER_POLL_MS = 30;
const DRAG_POLL_MS = 8;
const CLICK_SLOP_PX = 4;

let win = null;
let tray = null;
let hoverTimer = null;
let press = null;         // нажатие на персонажа: { offsetX, offsetY, startX, startY, moved, timer }
let hitRects = [];         // где в окне есть что-то кликабельное (сообщает renderer)
let ignoringMouse = true;
// Спрятан ли компаньон. Окно при этом не прячется через hide(): после hide()/show() Chromium
// не возвращает в строй дочернее окно страницы, и клики по персонажу перестают доходить.
let isHidden = false;
let settings = { tts: false, position: null, scale: 1, locked: false };

// ---------- settings ----------

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    // первый запуск — остаются значения по умолчанию
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err.message);
  }
}

// ---------- window ----------

function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WINDOW_WIDTH - SCREEN_MARGIN,
    y: workArea.y + workArea.height - WINDOW_HEIGHT,
  };
}

function isOnSomeScreen({ x, y }) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    x + WINDOW_WIDTH / 2 >= a.x && x + WINDOW_WIDTH / 2 <= a.x + a.width &&
    y + WINDOW_HEIGHT / 2 >= a.y && y + WINDOW_HEIGHT / 2 <= a.y + a.height);
}

function createWindow() {
  const pos = settings.position && isOnSomeScreen(settings.position) ? settings.position : defaultPosition();

  win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Поверх полноэкранных окон тоже
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  // Пустые области окна пропускают клики насквозь; над персонажем окно принимает мышь (см. pollHover)
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.send('settings', settings));
  // Таймеры опроса мыши переживают окно: без этого они дёргают уничтоженный win до выхода
  win.on('closed', () => {
    clearInterval(hoverTimer);
    if (press) clearInterval(press.timer);
    press = null;
    win = null;
  });
}

function resetPosition() {
  const pos = defaultPosition();
  win.setBounds({ ...pos, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  settings.position = null;
  saveSettings();
}

// ---------- menu / tray ----------

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Read aloud',
      type: 'checkbox',
      checked: settings.tts,
      click: (item) => {
        settings.tts = item.checked;
        saveSettings();
        win.webContents.send('settings', settings);
      },
    },
    {
      label: 'Size',
      submenu: [0.75, 1, 1.25, 1.5].map((scale) => ({
        label: `${Math.round(scale * 100)}%`,
        type: 'radio',
        checked: settings.scale === scale,
        click: () => {
          settings.scale = scale;
          saveSettings();
          win.webContents.send('settings', settings);
        },
      })),
    },
    {
      label: 'Lock in place',
      type: 'checkbox',
      checked: settings.locked,
      click: (item) => {
        settings.locked = item.checked;
        saveSettings();
        win.webContents.send('settings', settings);
        tray.setContextMenu(buildMenu());
      },
    },
    { label: 'Try it (demo)', click: () => runDemo() },
    { label: 'Back to corner', click: resetPosition },
    { type: 'separator' },
    { label: isHidden ? 'Show' : 'Hide', click: toggleVisible },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function setHidden(hidden) {
  isHidden = hidden;
  win.webContents.send('hidden', hidden);
  if (hidden) setIgnoreMouse(true);
  else pollHover();
  tray.setContextMenu(buildMenu());
}

function toggleVisible() {
  setHidden(!isHidden);
}

function showWindow() {
  if (isHidden) setHidden(false);
}

// Как запустить это же приложение снова: читает плагин Claude Code для команды /companion
function writeLaunchInfo() {
  const info = { argv: [process.execPath, app.getAppPath()], port: PORT };
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'launch.json'), JSON.stringify(info, null, 2));
  } catch (err) {
    console.error('Failed to write launch.json:', err.message);
  }
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, 'renderer', 'frames', 'frame_00.png'))
    .resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(icon);
  tray.setToolTip(`AI Companion — listening on ${HOST}:${PORT}`);
  tray.setContextMenu(buildMenu());
  tray.on('click', toggleVisible);
}

function runDemo() {
  const steps = [
    [0, { source: 'demo', type: 'status', state: 'thinking' }],
    [1800, { source: 'demo', type: 'status', state: 'working', detail: 'Read main.js' }],
    [3400, { source: 'demo', type: 'status', state: 'working', detail: 'Edit companion.js' }],
    [5000, { source: 'demo', type: 'status', state: 'waiting', detail: 'Allow running npm test?' }],
    [7000, { source: 'demo', type: 'status', state: 'working', detail: 'npm test' }],
    [8600, { source: 'demo', type: 'say', text: 'Done! I fixed the mouth animation and ran the tests — all green. Go take a look 🎉' }],
  ];
  for (const [delay, event] of steps) setTimeout(() => dispatch(event), delay);
}

// ---------- events ----------

function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('expected a JSON object');
  const type = raw.type === 'say' ? 'say' : 'status';
  const state = STATES.includes(raw.state) ? raw.state : type === 'say' ? 'done' : 'idle';
  return {
    source: String(raw.source ?? 'unknown').slice(0, 40),
    type,
    state,
    detail: raw.detail ? String(raw.detail).slice(0, 200) : '',
    text: raw.text ? String(raw.text).slice(0, 20000) : '',
  };
}

function dispatch(raw) {
  const event = normalize(raw);
  if (event.type === 'say' && !event.text) return;
  win?.webContents.send('companion-event', event);
}

function startServer() {
  const server = http.createServer((req, res) => {
    // Только локальные клиенты без браузерного Origin: веб-страницы не должны управлять компаньоном
    if (req.headers.origin) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, visible: !isHidden }));
      return;
    }
    if (req.method === 'POST' && req.url === '/show') {
      showWindow();
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on('end', () => {
      try {
        dispatch(JSON.parse(body));
        res.writeHead(204).end();
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(err.message);
      }
    });
  });

  server.on('error', (err) => {
    console.error(`Companion HTTP server failed to start (${HOST}:${PORT}):`, err.message);
  });
  server.listen(PORT, HOST);
}

// ---------- ipc ----------

// ---------- mouse ----------
// И «клики насквозь», и перетаскивание ведёт main по системному курсору: событиям мыши
// в прозрачном окне на Windows доверять нельзя (пересылка ломается, отпускание теряется).

function setIgnoreMouse(ignore) {
  if (ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  win.setIgnoreMouseEvents(ignore);
}

function pollHover() {
  if (!win || press) return;
  if (isHidden) {
    setIgnoreMouse(true);
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const x = cursor.x - b.x;
  const y = cursor.y - b.y;
  const over = hitRects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
  setIgnoreMouse(!over);
}

function startPress() {
  if (press) endPress(true);
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  press = { offsetX: cursor.x - x, offsetY: cursor.y - y, startX: cursor.x, startY: cursor.y, moved: false };
  setIgnoreMouse(false);
  press.timer = setInterval(stepPress, DRAG_POLL_MS);
}

function stepPress() {
  // Без koffi конец нажатия сообщает renderer (press-end)
  if (isPrimaryButtonDown && !isPrimaryButtonDown()) {
    endPress(false);
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  if (!press.moved && Math.hypot(cursor.x - press.startX, cursor.y - press.startY) > CLICK_SLOP_PX) press.moved = true;
  if (!press.moved || settings.locked) return;
  // setBounds с фиксированным размером: при дробном масштабе (125%, 171%…) setPosition
  // округляет координаты и окно «уплывает» и меняет размер
  win.setBounds({
    x: cursor.x - press.offsetX,
    y: cursor.y - press.offsetY,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  });
}

function endPress(cancelled) {
  if (!press) return;
  clearInterval(press.timer);
  const { moved } = press;
  press = null;
  if (moved && !settings.locked) {
    const [x, y] = win.getPosition();
    settings.position = { x, y };
    saveSettings();
  }
  if (!moved && !cancelled) win.webContents.send('poke');
  pollHover();
}

ipcMain.on('hit-rects', (_e, rects) => {
  hitRects = Array.isArray(rects) ? rects : [];
  pollHover();
});

ipcMain.on('press-start', () => startPress());
ipcMain.on('press-end', () => {
  if (!isPrimaryButtonDown) endPress(false);
});

ipcMain.on('show-menu', () => buildMenu().popup({ window: win }));

// ---------- app ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadSettings();
    createWindow();
    createTray();
    startServer();
    writeLaunchInfo();
    hoverTimer = setInterval(pollHover, HOVER_POLL_MS);
  });
  // Повторный запуск (например, из /companion) просто показывает уже открытое окно
  app.on('second-instance', () => win && showWindow());
  app.on('window-all-closed', () => app.quit());
}
