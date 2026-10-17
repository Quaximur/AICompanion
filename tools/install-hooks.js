#!/usr/bin/env node
// Подключает компаньона к Claude Code (~/.claude/settings.json) и Codex (~/.codex/hooks.json).
//   node tools/install-hooks.js               — установить в оба
//   node tools/install-hooks.js --only=claude — только Claude Code
//   node tools/install-hooks.js --uninstall   — убрать
// Перед записью рядом кладётся резервная копия *.bak-companion.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER = 'companion-hook.js';
const hookScript = path.resolve(__dirname, '..', 'hooks', MARKER).replace(/\\/g, '/');

const TARGETS = {
  claude: {
    file: path.join(os.homedir(), '.claude', 'settings.json'),
    source: 'claude-code',
    events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop'],
  },
  codex: {
    file: path.join(os.homedir(), '.codex', 'hooks.json'),
    source: 'codex',
    events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'],
  },
};

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest']);

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').trim();
  return text ? JSON.parse(text) : {};
}

function stripCompanion(hooks) {
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((h) => !String(h.command ?? '').includes(MARKER)) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
}

function apply(name, target, uninstall) {
  if (!fs.existsSync(path.dirname(target.file))) {
    console.log(`- ${name}: ${path.dirname(target.file)} не найден, пропускаю`);
    return;
  }
  const config = readJson(target.file);
  config.hooks ??= {};
  stripCompanion(config.hooks);

  if (!uninstall) {
    const command = `node "${hookScript}" ${target.source}`;
    for (const event of target.events) {
      const group = { hooks: [{ type: 'command', command, timeout: 5 }] };
      if (TOOL_EVENTS.has(event)) group.matcher = '*';
      (config.hooks[event] ??= []).push(group);
    }
  }
  if (!Object.keys(config.hooks).length) delete config.hooks;

  if (fs.existsSync(target.file)) fs.copyFileSync(target.file, target.file + '.bak-companion');
  fs.writeFileSync(target.file, JSON.stringify(config, null, 2) + '\n');
  console.log(`✓ ${name}: ${uninstall ? 'хуки удалены из' : 'хуки добавлены в'} ${target.file}`);
}

const uninstall = process.argv.includes('--uninstall');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

for (const [name, target] of Object.entries(TARGETS)) {
  if (only && only !== name) continue;
  try {
    apply(name, target, uninstall);
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}
if (!uninstall) console.log('Перезапустите Claude Code / Codex, чтобы хуки подхватились.');
