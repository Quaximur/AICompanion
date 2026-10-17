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
    if (!ok) console.error('Компаньон не отвечает — запустите его: npm start');
    return;
  }

  const steps = [
    [{ type: 'status', state: 'thinking' }, 2000],
    [{ type: 'status', state: 'working', detail: 'Read main.js' }, 1500],
    [{ type: 'status', state: 'working', detail: 'Edit companion.js' }, 1500],
    [{ type: 'status', state: 'waiting', detail: 'Разрешить запуск npm test?' }, 2500],
    [{ type: 'status', state: 'working', detail: 'Bash npm test' }, 1500],
    [{ type: 'say', text: '## Готово!\n\nЯ поправил **анимацию рта** и прогнал тесты — всё зелёное.\n\n```js\nconsole.log("hi")\n```\nМожешь проверять 🎉' }, 0],
  ];
  for (const [event, wait] of steps) {
    if (!(await sendEvent({ source: 'demo', ...event }))) {
      console.error('Компаньон не отвечает — запустите его: npm start');
      return;
    }
    await sleep(wait);
  }
}

main();
