import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const APPDATA = 'C:\\Users\\me\\AppData\\Roaming'
const LAUNCH_JSON = `${APPDATA}\\ai-companion\\launch.json`
const ELECTRON = 'C:\\apps\\companion\\electron.exe'

// Команда, набранная в поле ввода терминала
const RUN = {
  command: 'companion',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

type World = { companion: 'shown' | 'hidden' | 'offline'; runs: string[][]; shows: number }

// Мир под плагином: приложение компаньона, файловая система и процессы
function world(on: On, companion: World['companion']): World {
  const state: World = { companion, runs: [], shows: 0 }
  mock.env(on, { APPDATA })
  mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // То, что движок рисует сам, когда плагин уступает строку (next(e))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('http.fetch', (_$, e) => {
    if (state.companion === 'offline') return { deny: 'connect ECONNREFUSED' }
    if (e.url.endsWith('/show')) {
      state.shows += 1
      state.companion = 'shown'
      return { value: { status: 204, ok: true, headers: {}, text: '' } }
    }
    const visible = state.companion === 'shown'
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, visible }) } }
  })
  on('fs.read', (_$, e) => {
    if (e.path !== LAUNCH_JSON) return { deny: 'ENOENT' }
    return { value: JSON.stringify({ argv: [ELECTRON, 'C:\\apps\\companion'], port: 48159 }) }
  })
  on('fs.stat', (_$, e) => {
    if (e.path !== ELECTRON) return { deny: 'ENOENT' }
    return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
  })
  on('process.run', (_$, e) => {
    state.runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return state
}

test('/companion запускает закрытого компаньона отвязанным процессом', async ($, on) => {
  const w = world(on, 'offline')
  const { text } = await $.command.run(RUN)
  expect(text).toBe('Запускаю компаньона…')
  expect(w.runs.length).toBe(1)
  const [exe, , , , command] = w.runs[0] ?? []
  expect(exe).toBe('powershell.exe')
  expect(command).toBe(`Start-Process -FilePath '${ELECTRON}' -ArgumentList '"C:\\apps\\companion"'`)
})

test('/companion показывает спрятанного компаньона без нового запуска', async ($, on) => {
  const w = world(on, 'hidden')
  const { text } = await $.command.run(RUN)
  expect(text).toBe('Компаньон снова на экране.')
  expect(w.shows).toBe(1)
  expect(w.runs.length).toBe(0)
})

test('/companion ничего не делает, если компаньон уже на экране', async ($, on) => {
  const w = world(on, 'shown')
  const { text } = await $.command.run(RUN)
  expect(text).toBe('Компаньон уже на экране.')
  expect(w.runs.length + w.shows).toBe(0)
})

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const SURFACES = ['terminal', 'desktop'] as const

test('кнопка над полем ввода появляется без компаньона и запускает его', async ($, on) => {
  const w = world(on, 'offline')
  for (const surface of SURFACES) {
    w.companion = 'offline'
    w.runs = []
    await $.session.start({ cwd: 'C:/work', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'ai-companion', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ key: 'companion-start' })).toBeDefined()
    await ui.press({ key: 'companion-start' })
    expect(w.runs.length).toBe(1)
    await ui.unmount()
  }
})

test('кнопки нет, когда компаньон запущен', async ($, on) => {
  world(on, 'shown')
  for (const surface of SURFACES) {
    await $.session.start({ cwd: 'C:/work', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'ai-companion', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ key: 'companion-start' })).toBeUndefined()
    await ui.unmount()
  }
})
