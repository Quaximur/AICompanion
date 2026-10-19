#!/usr/bin/env node
// Подключает компаньона к Codex (~/.codex/hooks.json).
//   node tools/install-hooks.js             — установить
//   node tools/install-hooks.js --uninstall — убрать
// Claude Code подключается плагином (см. README). Из ~/.claude/settings.json скрипт только
// убирает хуки, прописанные вручную прежними версиями, чтобы события не приходили дважды.
// Перед записью рядом кладётся резервная копия *.bak-companion.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER = 'companion-hook.js';
const hookScript = path.resolve(__dirname, '..', 'plugin', 'scripts', MARKER).replace(/\\/g, '/');

const TARGETS = {
  claude: {
    file: path.join(os.homedir(), '.claude', 'settings.json'),
    cleanupOnly: true,
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
    console.log(`- ${name}: ${path.dirname(target.file)} not found, skipping`);
    return;
  }
  const config = readJson(target.file);
  if (target.cleanupOnly && !JSON.stringify(config.hooks ?? {}).includes(MARKER)) return;
  config.hooks ??= {};
  stripCompanion(config.hooks);

  const install = !uninstall && !target.cleanupOnly;
  if (install) {
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
  console.log(`✓ ${name}: ${install ? 'hooks added to' : 'hooks removed from'} ${target.file}`);
}

const uninstall = process.argv.includes('--uninstall');

for (const [name, target] of Object.entries(TARGETS)) {
  try {
    apply(name, target, uninstall);
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}
if (!uninstall) console.log('Restart Codex to pick up the hooks.');
