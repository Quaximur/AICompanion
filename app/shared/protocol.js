// Общий протокол событий компаньона. Любой источник шлёт POST /event с JSON:
//   { source: "claude-code" | "codex" | "claude-desktop" | string,
//     type:   "status" | "say",
//     state?: "idle" | "thinking" | "working" | "waiting" | "done" | "error",
//     detail?: string,   // подпись к режиму, например «Edit main.js»
//     text?:  string }   // для type = "say": что сказать в облачке

const PORT = Number(process.env.AI_COMPANION_PORT) || 48159;
const HOST = '127.0.0.1';

const STATES = ['idle', 'thinking', 'working', 'waiting', 'done', 'error'];

async function sendEvent(event, timeoutMs = 800) {
  try {
    await fetch(`http://${HOST}:${PORT}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    // Компаньон не запущен — агенту это не должно мешать
    return false;
  }
}

module.exports = { PORT, HOST, STATES, sendEvent };
