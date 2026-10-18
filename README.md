# AI Companion

**English** · [Русский](README.ru.md)

<p align="center">
  <img src="docs/companion.png" width="220" alt="The companion: a little horned dragon talking and winking">
</p>

An animated companion that lives in a corner of your screen. It shows what your AI agent is doing right now (thinking, editing a file, waiting for your approval) and reads the agent's answer back in a speech bubble with mouth animation. It has no input field of its own: you keep talking to the agent in its usual desktop app, and the companion only shows what is going on.

## Stack

- **Electron**: a transparent, frameless, always-on-top window; clicks pass through its empty areas. Lives in the system tray. Dragging and click-through are driven by the main process from the system cursor; the mouse button state is read from Windows through **koffi** (`GetAsyncKeyState`).
- **Plain HTML/CSS/JS**: sprite-sheet frames, CSS animations for each state, and a typewriter that picks the mouth shape from the vowels it prints.
- **Local HTTP** on `127.0.0.1:48159`: a single entry point for events from every agent.
- **Claude Code plugin and Codex hooks**: the shared script `plugin/scripts/companion-hook.js` turns agent events into companion events.
- **MCP server** `mcp/companion-mcp.js` for apps without hooks (the Chat tab of Claude Desktop).
- **Python + Pillow** `tools/slice_sprites.py`: slices the sprite sheet and aligns the frames.

## Running

```bash
npm install
npm start
```

Try it without an agent:

```bash
npm run demo
```

To make the companion say something:

```bash
node tools/demo.js "Hello!"
```

The interface is in Russian for now. Right-click the character or use the tray icon to open the menu: read aloud (Windows SAPI), size, pin in place, demo, back to the corner, quit. You can drag the character with the mouse unless it is pinned. Clicking a bubble that is still typing shows the whole text at once; clicking it again closes it.

## Connecting agents

| App | How it connects | What it shows |
|---|---|---|
| Claude Code (CLI, the Code tab of Claude Desktop, IDEs) | the `ai-companion` plugin | every state + the final answer |
| Codex (CLI, Codex app, IDEs) | hooks in `~/.codex/hooks.json` | every state + the final answer |
| Claude Desktop, Chat tab | MCP server | whatever the model chooses to report through the tools |
| ChatGPT Desktop (regular chat) | not yet: the app has no hooks and no local MCP | — |

### Claude Code: the plugin

The plugin lives in `plugin/`, and this repository is its marketplace. Install it from GitHub:

```bash
claude plugin marketplace add Quaximur/AICompanion
```

```bash
claude plugin install ai-companion@ai-companion
```

For local development, pass the path to the project folder instead of `Quaximur/AICompanion`; the plugin is then read straight from `plugin/`.

Turn the plugin off and on:

```bash
claude plugin disable ai-companion@ai-companion
```

```bash
claude plugin enable ai-companion@ai-companion
```

In interactive Claude Code the same is available under `/plugin`. Changes apply to new sessions or after `/reload-plugins`.

#### Opening the companion from Claude Code

- The `/companion` command in the `/` menu shows a hidden companion, or starts the app if it is closed.
- While the companion is not running, a row above the prompt says «Компаньон не запущен» ("the companion is not running") and offers «Запустить» (start) and «Скрыть» (hide) buttons.

The plugin learns where the app is from `%APPDATA%\ai-companion\launch.json`, which the app writes every time it starts. If the app has never been started, the plugin looks for it next to itself (this works when the plugin is installed from the project folder). If it finds nothing, start the companion once by hand with `npm start`.

Plugin tests:

```bash
claude plugin test ./plugin
```

### Codex

```bash
npm run hooks:install
```

The script adds the hooks to `~/.codex/hooks.json` (saving a `*.bak-companion` copy first) and leaves your existing hooks alone. If `~/.claude/settings.json` still has companion hooks added by hand by an older version, the script removes them, so events do not arrive twice while the plugin is on. Restart Codex afterwards. To remove the hooks:

```bash
npm run hooks:uninstall
```

How agent events map to companion states:

| Agent event | State |
|---|---|
| `UserPromptSubmit` | thinking |
| `PreToolUse` | working: `Edit main.js` |
| `PermissionRequest` / `Notification` | waiting for you |
| `Stop` | reads the last answer out in a bubble |

If the companion is not running, the hook quietly exits within 0.8 s and does not get in the agent's way.

### Claude Desktop (Chat)

Add the server to `%APPDATA%\Claude\claude_desktop_config.json`, with the path to your copy of the project:

```json
{
  "mcpServers": {
    "companion": {
      "command": "node",
      "args": ["C:/path/to/AICompanion/mcp/companion-mcp.js"]
    }
  }
}
```

The model gets the `companion_status` and `companion_say` tools. To have it use them every time, add something like this to the project instructions: "At the end of every answer, call companion_say with a short summary."

## Event protocol

Any program can drive the companion:

```bash
curl -X POST http://127.0.0.1:48159/event -H "Content-Type: application/json" -d "{\"source\":\"my-tool\",\"type\":\"status\",\"state\":\"working\",\"detail\":\"Build\"}"
```

- `type`: `status` or `say`
- `state`: `idle`, `thinking`, `working`, `waiting`, `done`, `error`
- `text`: the text for `say`; markdown is simplified and long text is cut to about 900 characters

Requests with an `Origin` header (that is, from web pages) are rejected.

## Your own character

Put a 4×4 sprite sheet with a transparent background in `assets/sheet.webp` and run:

```bash
npm run frames
```

Which frame is which (mouth closed, half open, wide open, a wink and so on) is set in `FRAME` and `MOUTH` at the top of `app/renderer/companion.js`.
