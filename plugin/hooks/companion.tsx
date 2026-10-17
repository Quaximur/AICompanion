import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CompanionStatus, LaunchInfo } from '../types'

// Команда /companion и кнопка над полем ввода: показать компаньона, а если он закрыт — запустить.

const BASE_URL = 'http://127.0.0.1:48159'
const POLL_MS = 15_000
const LAUNCH_CHECKS_MS = [1500, 4000, 8000]

const status = atom({ plugin: 'ai-companion', key: 'status' } as const, 'unknown' as CompanionStatus)
const isBandHidden = atom({ plugin: 'ai-companion', key: 'isBandHidden' } as const, false)

async function fetchStatus($: EngineInterface): Promise<CompanionStatus> {
  try {
    const { ok, text } = await $.http.fetch(`${BASE_URL}/health`)
    if (!ok) return 'offline'
    const health = JSON.parse(text) as { visible?: boolean }
    // Старые версии приложения не сообщают visible — считаем, что окно на экране
    return health.visible === false ? 'hidden' : 'shown'
  } catch {
    return 'offline'
  }
}

async function refreshStatus($: EngineInterface): Promise<CompanionStatus> {
  const next = await fetchStatus($)
  if ((await read($, status)) !== next) await update($, status, () => next)
  return next
}

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

// Как запустить приложение: то, что оно само записало при прошлом запуске,
// иначе — проект рядом с плагином (плагин установлен из папки репозитория)
async function findLaunchArgv($: EngineInterface): Promise<string[] | undefined> {
  const appData = await $.env.get('APPDATA')
  if (appData) {
    try {
      const info = JSON.parse(await $.fs.read(`${appData}\\ai-companion\\launch.json`)) as LaunchInfo
      const exe = info.argv[0]
      if (exe && (await exists($, exe))) return info.argv
    } catch {
      // приложение ещё ни разу не запускалось
    }
  }

  const projectDir = `${$.plugin.root}/..`
  const electron = `${projectDir}/node_modules/electron/dist/electron.exe`
  if (await exists($, electron)) return [electron, projectDir]
  return undefined
}

const quotePs = (value: string) => `'${value.replaceAll("'", "''")}'`

async function launch($: EngineInterface, argv: string[]): Promise<void> {
  const [exe, ...args] = argv
  if (!exe) throw new Error('пустая команда запуска')
  // Start-Process отвязывает приложение от сессии: $.process.run ждёт выхода
  // запущенной программы, а компаньон должен жить дальше
  const argList = args.map((arg) => quotePs(`"${arg}"`)).join(',')
  const command = `Start-Process -FilePath ${quotePs(exe)}${argList ? ` -ArgumentList ${argList}` : ''}`
  const { exitCode, stderr } = await $.process.run(
    ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
    { timeoutMs: 15_000 },
  )
  if (exitCode !== 0) throw new Error(stderr.trim() || `powershell exited with ${exitCode}`)
}

async function openCompanion($: EngineInterface): Promise<string> {
  const current = await refreshStatus($)
  if (current === 'shown') return 'Компаньон уже на экране.'

  if (current === 'hidden') {
    await $.http.fetch(`${BASE_URL}/show`, { method: 'POST' })
    await refreshStatus($)
    return 'Компаньон снова на экране.'
  }

  const argv = await findLaunchArgv($)
  if (!argv) {
    return 'Не нашёл, где установлено приложение AI Companion. Запустите его один раз вручную (npm start в папке проекта) — после этого /companion будет запускать его сам.'
  }
  try {
    await launch($, argv)
  } catch (err) {
    return `Не удалось запустить компаньона: ${err instanceof Error ? err.message : String(err)}`
  }
  for (const ms of LAUNCH_CHECKS_MS) $.clock.after(ms, () => void refreshStatus($))
  return 'Запускаю компаньона…'
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'companion',
      description: 'Показать компаньона на рабочем столе (запустить, если он закрыт)',
      immediate: true,
    })
    await refreshStatus($)
    $.clock.every(POLL_MS, () => void refreshStatus($))
    return next(e)
  })

  on('command.run', { command: 'companion' }, async ($) => ({ text: await openCompanion($) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isQuiet =
      e.props.hasSurvey || (await read($, status)) !== 'offline' || (await read($, isBandHidden))
    if (isQuiet) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>Компаньон не запущен</Text>
        <Button
          key="companion-start"
          label="Запустить"
          variant="primary"
          onPress={async () => $.ui.toast(await openCompanion($))}
        />
        <Button key="companion-hide" label="Скрыть" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })
}
