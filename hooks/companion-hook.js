#!/usr/bin/env node
// Хук для Claude Code и Codex: превращает события агента в события компаньона.
// Использование в настройках хуков: node <path>/companion-hook.js claude-code|codex
// Хук никогда не мешает агенту: ничего не пишет в stdout и всегда завершается с кодом 0.

const fs = require('node:fs');
const path = require('node:path');
const { sendEvent } = require('../app/shared/protocol');

const source = process.argv[2] || 'claude-code';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function shorten(text, max = 60) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

// Подпись к инструменту: «Edit main.js», «Bash npm test»
function describeTool(name, input = {}) {
  const tool = String(name ?? '').replace(/^mcp__[^_]+__/, '');
  const target =
    input.file_path || input.path || input.notebook_path
      ? path.basename(input.file_path || input.path || input.notebook_path)
      : input.command ?? input.cmd ?? input.pattern ?? input.query ?? input.url ?? input.description ?? '';
  const arg = Array.isArray(target) ? target.join(' ') : target;
  return shorten(arg ? `${tool} ${arg}` : tool);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && (part.type === 'text' || part.type === 'output_text'))
    .map((part) => part.text)
    .join('\n');
}

// Последний ответ ассистента из транскрипта (JSONL Claude Code или rollout Codex)
function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    // Claude Code: { type: "assistant", message: { role, content: [...] } }
    // Codex:       { type: "response_item", payload: { type: "message", role, content: [...] } }
    const msg = entry.message ?? entry.payload ?? entry;
    const role = msg.role ?? entry.type;
    if (role === 'assistant') {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      if (blocks.some((b) => b?.type === 'tool_use')) break; // дальше — текст до вызова инструментов
      const text = textOf(msg.content);
      if (text) parts.unshift(text);
    } else if (role === 'user') {
      const isToolResult = Array.isArray(msg.content) && msg.content.some((b) => b?.type === 'tool_result');
      if (!isToolResult) break;
      if (parts.length) break;
    } else if (msg.type === 'function_call' || msg.type === 'custom_tool_call') {
      if (parts.length) break;
    }
  }
  return parts.join('\n\n').trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function eventFor(input) {
  const name = input.hook_event_name ?? input.hookEventName ?? '';
  switch (name) {
    case 'SessionStart':
      return { type: 'status', state: 'idle' };
    case 'UserPromptSubmit':
      return { type: 'status', state: 'thinking' };
    case 'PreToolUse':
      return { type: 'status', state: 'working', detail: describeTool(input.tool_name, input.tool_input) };
    case 'PostToolUse':
      return { type: 'status', state: 'thinking' };
    case 'PermissionRequest':
      return { type: 'status', state: 'waiting', detail: describeTool(input.tool_name, input.tool_input) };
    case 'Notification': {
      // idle_prompt — агент просто ждёт ввода, это не требует внимания
      if (input.notification_type === 'idle_prompt') return null;
      return { type: 'status', state: 'waiting', detail: shorten(input.message, 80) };
    }
    case 'Stop': {
      let text = input.last_assistant_message ?? input['last-assistant-message'] ?? '';
      if (!text) {
        // Транскрипт иногда дописывается чуть позже, чем срабатывает Stop
        for (let attempt = 0; attempt < 3 && !text; attempt++) {
          if (attempt) await sleep(250);
          text = lastAssistantText(input.transcript_path);
        }
      }
      return text ? { type: 'say', state: 'done', text } : { type: 'status', state: 'done' };
    }
    case 'StopFailure':
      return { type: 'status', state: 'error', detail: shorten(input.error ?? input.message, 80) };
    default:
      return null;
  }
}

async function main() {
  try {
    const raw = await readStdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const event = await eventFor(input);
    if (event) await sendEvent({ source, ...event });
  } catch {
    // молча: хук не должен ломать работу агента
  }
  process.exit(0);
}

if (require.main === module) main();
else module.exports = { eventFor, lastAssistantText, describeTool };
