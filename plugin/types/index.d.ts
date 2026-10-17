// shown — окно на экране, hidden — запущен, но спрятан, offline — не запущен
export type CompanionStatus = 'unknown' | 'shown' | 'hidden' | 'offline'

// Что пишет приложение в %APPDATA%\ai-companion\launch.json при каждом запуске
export type LaunchInfo = { argv: string[]; port: number }

declare module 'claude-code' {
  interface PluginState {
    'ai-companion': { status: CompanionStatus; isBandHidden: boolean }
  }
}
