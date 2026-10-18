'use strict';

// Кадры спрайт-листа (порядок — по строкам, см. tools/slice_sprites.py)
const FRAME = {
  neutral: 0, wink: 1, mouthO: 2, smile: 3,
  laugh: 4, mouthO2: 5, smile2: 6, smile3: 7,
  pout: 8, smug: 9, winkOpen: 10, laugh2: 11,
  neutral2: 12, surprised: 13, winkOpen2: 14, neutral3: 15,
};
const FRAME_COUNT = 16;

// Рот при речи: закрыт / приоткрыт / широко открыт
const MOUTH = {
  closed: [FRAME.neutral, FRAME.neutral2],
  small: [FRAME.mouthO, FRAME.mouthO2],
  wide: [FRAME.smile, FRAME.smile2, FRAME.smile3],
};

const STATE_FACE = {
  idle: FRAME.neutral,
  thinking: FRAME.smug,
  working: FRAME.pout,
  waiting: FRAME.surprised,
  done: FRAME.laugh,
  error: FRAME.pout,
};

const STATE_LABEL = {
  idle: 'Отдыхаю',
  thinking: 'Думаю…',
  working: 'Работаю',
  waiting: 'Жду тебя',
  done: 'Готово',
  error: 'Ошибка',
  speaking: 'Отвечаю',
};

const SOURCE_LABEL = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude',
  codex: 'Codex',
  demo: 'Демо',
};

const MAX_SPOKEN_CHARS = 900;
const MIN_FRAME_MS = 70;
const DONE_TO_IDLE_MS = 2500;
const IDLE_CHIP_HIDE_MS = 4000;

const $ = (id) => document.getElementById(id);
const els = {
  buddy: $('buddy'),
  sprite: $('sprite'),
  thought: $('thought'),
  bubble: $('bubble'),
  bubbleSource: $('bubble-source'),
  bubbleText: $('bubble-text'),
  chip: $('chip'),
  chipText: $('chip-text'),
};

const bridge = window.companion ?? null;
let settings = { tts: false, scale: 1 };

// ---------- кадры ----------

const frameUrls = Array.from({ length: FRAME_COUNT }, (_, i) => `frames/frame_${String(i).padStart(2, '0')}.png`);
// Прогреваем кэш, чтобы смена кадров не мигала
const preloaded = frameUrls.map((url) => Object.assign(new Image(), { src: url }));

let currentFrame = 0;
let lastFrameAt = 0;

function setFrame(index, force = false) {
  const now = performance.now();
  if (index === currentFrame) return;
  if (!force && now - lastFrameAt < MIN_FRAME_MS) return;
  currentFrame = index;
  lastFrameAt = now;
  els.sprite.src = preloaded[index].src;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---------- режимы ----------

let mode = 'idle';           // базовый режим агента
let speaking = false;
let modeTimer = null;
let chipTimer = null;
let modeMeta = {};

function setBuddyState(state) {
  els.buddy.className = 'interactive state-' + state + (settings.locked ? ' locked' : '');
}

function applyBuddyClass() {
  setBuddyState(speaking ? 'speaking' : mode);
}

function setMode(state, { source = '', detail = '' } = {}) {
  mode = state;
  modeMeta = { source, detail };
  clearTimeout(modeTimer);
  clearTimeout(chipTimer);

  els.thought.classList.toggle('hidden', state !== 'thinking' || speaking);
  if (!speaking) setFrame(STATE_FACE[state], true);
  applyBuddyClass();

  showChip(state, source, detail);

  if (state === 'done') modeTimer = setTimeout(() => setMode('idle'), DONE_TO_IDLE_MS);
  if (state === 'idle') chipTimer = setTimeout(() => els.chip.classList.add('hidden'), IDLE_CHIP_HIDE_MS);
}

function showChip(state, source, detail = '') {
  const label = detail ? `${STATE_LABEL[state]}: ${detail}` : STATE_LABEL[state];
  const who = SOURCE_LABEL[source] ?? source;
  els.chipText.textContent = who && state !== 'idle' ? `${who} · ${label}` : label;
  els.chip.className = 'interactive state-' + state;
}

// Моргание и «живость» в простое
function scheduleIdleLife() {
  setTimeout(() => {
    if (!speaking && (mode === 'idle' || mode === 'working')) {
      const base = STATE_FACE[mode];
      setFrame(FRAME.wink, true);
      setTimeout(() => !speaking && setFrame(base, true), 160);
    } else if (!speaking && mode === 'thinking') {
      setFrame(currentFrame === FRAME.smug ? FRAME.neutral3 : FRAME.smug, true);
    }
    scheduleIdleLife();
  }, 2500 + Math.random() * 3500);
}

// ---------- текст ----------

// Убираем markdown, чтобы в облачке читалось как речь
function toSpeech(text) {
  let out = text
    .replace(/```[\s\S]*?```/g, ' [код] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\W)[*_](\S[^*_]*)[*_](?=\W|$)/g, '$1$2')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (out.length > MAX_SPOKEN_CHARS) {
    const cut = out.lastIndexOf(' ', MAX_SPOKEN_CHARS);
    out = out.slice(0, cut > MAX_SPOKEN_CHARS * 0.7 ? cut : MAX_SPOKEN_CHARS) + '…';
  }
  return out;
}

const WIDE_VOWELS = /[аяэеёaeä]/i;
const SMALL_VOWELS = /[оуюыиoui]/i;
const PAUSE = /[\s.,!?;:…—\-()"«»\n]/;

function mouthFor(ch) {
  if (WIDE_VOWELS.test(ch)) return pick(MOUTH.wide);
  if (SMALL_VOWELS.test(ch)) return pick(MOUTH.small);
  if (PAUSE.test(ch)) return MOUTH.closed[0];
  return null; // согласная — рот остаётся как был
}

// ---------- облачко ----------

let speech = null; // { text, shown, timer, hideTimer, utterance }

function cancelSpeech() {
  if (!speech) return;
  clearTimeout(speech.timer);
  clearTimeout(speech.hideTimer);
  if (speech.utterance) window.speechSynthesis?.cancel();
  speech = null;
}

function renderBubbleText(text, shown) {
  // Невидимый «хвост» сразу задаёт облачку итоговый размер — оно не прыгает во время печати
  els.bubbleText.textContent = text.slice(0, shown);
  if (shown < text.length) {
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    const rest = document.createElement('span');
    rest.className = 'rest';
    rest.textContent = text.slice(shown);
    els.bubbleText.append(cursor, rest);
    const box = els.bubbleText;
    box.scrollTop = Math.max(0, cursor.offsetTop + cursor.offsetHeight - box.clientHeight + 6);
  }
}

function say(rawText, source) {
  cancelSpeech();
  const text = toSpeech(rawText);
  if (!text) return;

  // Ответ пришёл — значит агент закончил ход; новые события во время речи обновят режим
  mode = 'done';
  modeMeta = { source };
  clearTimeout(modeTimer);
  clearTimeout(chipTimer);
  speaking = true;
  els.thought.classList.add('hidden');
  applyBuddyClass();
  showChip('speaking', source);

  els.bubbleSource.textContent = SOURCE_LABEL[source] ?? source ?? '';
  els.bubble.classList.remove('hidden', 'leaving');
  renderBubbleText(text, 0);

  speech = { text, shown: 0, timer: null, hideTimer: null, utterance: null };
  if (settings.tts && window.speechSynthesis) speakAloud(speech);
  else typeNext(speech);
}

// Скорость печати: короткие фразы — 30 символов/с, длинные ускоряются, но не дольше ~14 с
function charDelay(length) {
  return Math.max(12, Math.min(33, 14000 / length));
}

function typeNext(s) {
  if (speech !== s) return;
  const ch = s.text[s.shown];
  s.shown += 1;
  renderBubbleText(s.text, s.shown);

  const mouth = mouthFor(ch);
  if (mouth !== null) setFrame(mouth);

  if (s.shown >= s.text.length) {
    finishSpeech(s);
    return;
  }
  const pause = /[.!?…\n]/.test(ch) ? 220 : /[,;:—]/.test(ch) ? 110 : 0;
  s.timer = setTimeout(() => typeNext(s), charDelay(s.text.length) + pause);
}

function speakAloud(s) {
  const utterance = new SpeechSynthesisUtterance(s.text);
  const cyrillic = /[а-яё]/i.test(s.text);
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang.toLowerCase().startsWith(cyrillic ? 'ru' : 'en'));
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? (cyrillic ? 'ru-RU' : 'en-US');
  utterance.rate = 1.05;
  utterance.pitch = 1.25;
  s.utterance = utterance;

  // Рот двигается, пока движок говорит; текст догоняет границы слов
  const flap = () => {
    if (speech !== s) return;
    setFrame(Math.random() < 0.25 ? MOUTH.closed[0] : pick(Math.random() < 0.5 ? MOUTH.small : MOUTH.wide));
    s.timer = setTimeout(flap, 90 + Math.random() * 70);
  };
  utterance.onstart = flap;
  utterance.onboundary = (e) => {
    if (speech !== s) return;
    const end = s.text.indexOf(' ', e.charIndex + 1);
    s.shown = end === -1 ? s.text.length : end;
    renderBubbleText(s.text, s.shown);
  };
  utterance.onend = () => {
    if (speech !== s) return;
    clearTimeout(s.timer);
    s.shown = s.text.length;
    renderBubbleText(s.text, s.text.length);
    finishSpeech(s);
  };
  utterance.onerror = () => {
    if (speech !== s) return;
    clearTimeout(s.timer);
    s.utterance = null;
    typeNext(s); // голос недоступен — просто печатаем
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function finishSpeech(s) {
  speaking = false;
  const busy = ['thinking', 'working', 'waiting'].includes(mode);
  if (busy) {
    // пока говорили, агент уже взялся за новую задачу
    setMode(mode, modeMeta);
  } else {
    setFrame(FRAME.laugh, true);
    setMode('done');
  }
  // Облачко висит пропорционально длине текста; наведение мыши его задерживает
  const readMs = Math.min(30000, 4000 + s.text.length * 45);
  scheduleBubbleHide(s, readMs);
}

function scheduleBubbleHide(s, ms) {
  clearTimeout(s.hideTimer);
  s.hideTimer = setTimeout(() => {
    if (speech !== s) return;
    if (els.bubble.matches(':hover')) {
      scheduleBubbleHide(s, 1500);
      return;
    }
    hideBubble();
  }, ms);
}

function hideBubble() {
  cancelSpeech();
  if (speaking) {
    speaking = false;
    setMode(mode === 'done' ? 'idle' : mode, modeMeta);
  }
  els.bubble.classList.add('leaving');
  setTimeout(() => {
    if (!speech) els.bubble.classList.add('hidden');
  }, 200);
}

// ---------- события ----------

function handleEvent(event) {
  if (event.type === 'say') {
    say(event.text, event.source);
    return;
  }
  // Новая работа агента прерывает недочитанное облачко только если оно уже договорено
  if (event.state !== 'done' && speech && speech.shown >= speech.text.length) hideBubble();
  setMode(event.state, event);
}

// ---------- мышь ----------
// Клики насквозь и перетаскивание ведёт main по системному курсору. Renderer только
// сообщает, где лежат кликабельные элементы, и что на персонажа нажали.

const HIT_PADDING = 2;
let lastHitRects = '';

function reportHitRects() {
  const rects = [...document.querySelectorAll('.interactive:not(.hidden)')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.floor(r.left - HIT_PADDING),
      y: Math.floor(r.top - HIT_PADDING),
      width: Math.ceil(r.width + HIT_PADDING * 2),
      height: Math.ceil(r.height + HIT_PADDING * 2),
    };
  });
  const key = JSON.stringify(rects);
  if (key === lastHitRects) return;
  lastHitRects = key;
  bridge?.reportHitRects(rects);
}

// Анимации (подпрыгивание, появление облачка) двигают элементы — сверяемся часто, это дёшево
setInterval(reportHitRects, 100);

els.buddy.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  bridge?.pressStart();
});

// Нужен только если main не смог читать кнопку мыши из системы
window.addEventListener('pointerup', (e) => {
  if (e.button === 0) bridge?.pressEnd();
});

els.buddy.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  bridge?.showMenu();
});

els.bubble.addEventListener('click', () => {
  // Клик по печатающемуся облачку — показать весь текст сразу, по готовому — закрыть
  if (speech && speech.shown < speech.text.length && !speech.utterance) {
    clearTimeout(speech.timer);
    speech.shown = speech.text.length;
    renderBubbleText(speech.text, speech.text.length);
    finishSpeech(speech);
  } else {
    hideBubble();
  }
});

// Сердечки вылетают из персонажа при тыке
function spawnHearts() {
  for (let i = 0; i < 3; i++) {
    const heart = document.createElement('span');
    heart.className = 'heart';
    heart.textContent = pick(['♥', '♡', '✦']);
    heart.style.left = `${30 + Math.random() * 40}%`;
    heart.style.setProperty('--dx', `${(Math.random() - 0.5) * 50}px`);
    heart.style.animationDelay = `${i * 120}ms`;
    heart.addEventListener('animationend', () => heart.remove());
    els.buddy.append(heart);
  }
}

// Тык в персонажа — реакция
function poke() {
  if (speaking) return;
  spawnHearts();
  setFrame(pick([FRAME.winkOpen, FRAME.winkOpen2, FRAME.laugh2]), true);
  setBuddyState('done');
  setTimeout(() => {
    setFrame(STATE_FACE[mode], true);
    applyBuddyClass();
  }, 900);
}

// ---------- старт ----------

function applySettings(next) {
  settings = { ...settings, ...next };
  document.documentElement.style.setProperty('--scale', settings.scale ?? 1);
  els.buddy.classList.toggle('locked', !!settings.locked);
  if (!settings.tts && speech?.utterance) window.speechSynthesis.cancel();
}

if (bridge) {
  bridge.onEvent(handleEvent);
  bridge.onSettings(applySettings);
  bridge.onPoke(poke);
  bridge.onHidden((hidden) => document.body.classList.toggle('companion-hidden', hidden));
} else {
  // Открыто в обычном браузере — для отладки вёрстки
  window.companionDebug = { handleEvent, applySettings };
}

setMode('idle');
scheduleIdleLife();
