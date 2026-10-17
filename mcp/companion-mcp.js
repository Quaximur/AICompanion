#!/usr/bin/env node
// Минимальный MCP-сервер (stdio) для приложений без хуков, например Claude Desktop (вкладка Chat).
// Модель сама вызывает инструменты, чтобы показать свой режим и сказать фразу через компаньона.

const readline = require('node:readline');
const { sendEvent, STATES } = require('../app/shared/protocol');

const SOURCE = process.argv[2] || 'claude-desktop';
const PROTOCOL_VERSION = '2025-06-18';

const TOOLS = [
  {
    name: 'companion_status',
    description:
      'Показывает пользователю твой текущий режим через анимированного компаньона на рабочем столе. ' +
      'Вызывай в начале долгой работы (thinking/working) и когда ждёшь решения пользователя (waiting).',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: STATES, description: 'Режим работы' },
        detail: { type: 'string', description: 'Короткая подпись, до 60 символов' },
      },
      required: ['state'],
    },
  },
  {
    name: 'companion_say',
    description:
      'Компаньон на рабочем столе произносит фразу в облачке с анимацией речи. ' +
      'Вызывай в конце ответа с кратким (1–3 предложения) живым резюме для пользователя.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Что сказать' } },
      required: ['text'],
    },
  },
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function callTool(name, args = {}) {
  let delivered;
  if (name === 'companion_status') {
    delivered = await sendEvent({ source: SOURCE, type: 'status', state: args.state, detail: args.detail });
  } else if (name === 'companion_say') {
    delivered = await sendEvent({ source: SOURCE, type: 'say', text: args.text });
  } else {
    return null;
  }
  return {
    content: [{ type: 'text', text: delivered ? 'ok' : 'Компаньон не запущен — событие пропущено' }],
  };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // уведомления (notifications/initialized и т.п.)

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-companion', version: '0.1.0' },
      });
      break;
    case 'ping':
      reply(id, {});
      break;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      break;
    case 'tools/call': {
      const result = await callTool(params?.name, params?.arguments);
      if (result) reply(id, result);
      else fail(id, -32602, `Неизвестный инструмент: ${params?.name}`);
      break;
    }
    default:
      fail(id, -32601, `Метод не поддерживается: ${method}`);
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    fail(null, -32700, 'Parse error');
    return;
  }
  handle(msg).catch((err) => fail(msg.id ?? null, -32603, err.message));
});
