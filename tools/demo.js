#!/usr/bin/env node
// Прогоняет компаньона через все режимы, имитируя работу агента.
//   node tools/demo.js            — сценарий
//   node tools/demo.js "Привет!"  — просто сказать фразу

const { sendEvent } = require('../app/shared/protocol');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const phrase = process.argv.slice(2).join(' ');
  if (phrase) {
    const ok = await sendEvent({ source: 'demo', type: 'say', text: phrase });
    if (!ok) console.error('The companion is not responding — start it with: npm start');
    return;
  }

  const steps = [
    [{ type: 'status', state: 'thinking' }, 2000],
    [{ type: 'status', state: 'working', detail: 'Read main.js' }, 1500],
    [{ type: 'status', state: 'working', detail: 'Edit companion.js' }, 1500],
    [{ type: 'status', state: 'waiting', detail: 'Allow running npm test?' }, 2500],
    [{ type: 'status', state: 'working', detail: 'Bash npm test' }, 1500],
    [{ type: 'say', text: '## Done!\n\nI fixed the **mouth animation** and ran the tests — all green.\n\n```js\nconsole.log("hi")\n```\nGo take a look 🎉' }, 0],
  ];
  for (const [event, wait] of steps) {
    if (!(await sendEvent({ source: 'demo', ...event }))) {
      console.error('The companion is not responding — start it with: npm start');
      return;
    }
    await sleep(wait);
  }
}

main();
