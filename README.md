# opencode-notify-macos

Native macOS notifications for [OpenCode](https://opencode.ai). Get alerted when tasks complete, errors occur, or the AI needs your input — without staring at the terminal.

No Rosetta dependencies. Uses native AppleScript `display notification` through macOS Notification Center. No bundled Intel binaries, no `node-notifier`, no `terminal-notifier`.

## Why This Exists

You delegate a task and switch to another window. Now you're checking back every 30 seconds. Did it finish? Did it error? Is it waiting for permission?

There are several OpenCode notification plugins already, but many pull in heavy dependencies like `node-notifier` (which bundles an x86_64 `terminal-notifier` binary requiring Rosetta) or target multiple platforms with complex codepaths. The goal of this plugin is to keep things **simple and secure** — macOS only, no additional native dependencies, pure AppleScript through the built-in Notification Center.

- **Stay focused** — Work in other apps. A notification arrives when the AI needs you.
- **No Rosetta** — Pure AppleScript notifications. No Intel binaries, no deprecation warnings.
- **No extra dependencies** — No `node-notifier`, no `terminal-notifier`, no native compilation.
- **Smart defaults** — Only notifies for meaningful events. Parent-session filtering, focus detection, and quiet-hours support.

## Installation

### From npm (recommended)

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-notify-macos"]
}
```

OpenCode installs npm plugins automatically via Bun at startup.

### From local files

Copy the built plugin into your plugin directory:

```bash
# Build first
bun install && bun run build

# Copy to global plugins
cp dist/index.js ~/.config/opencode/plugins/opencode-notify-macos.js
```

Or reference the project directly:

```json
{
  "plugin": ["file:///path/to/opencode-notify-macos/dist/index.js"]
}
```

## macOS notification permissions

Notifications are attributed to your **terminal app**. If you hear a sound but see no banner:

1. Open **System Settings > Notifications**
2. Find your terminal (e.g. Ghostty, iTerm2, Terminal)
3. Set the notification style to **Banners** or **Alerts**

## How it works

| Event | Notifies? | Sound | Why |
|-------|-----------|-------|-----|
| Session complete | Yes | Glass | Main task done — time to review |
| Session error | Yes | Basso | Something broke — needs attention |
| Permission needed | Yes | Submarine | AI is blocked, waiting for you |
| Question asked | Yes | Submarine | Questions should always reach you |
| Sub-task complete/error | No (default) | — | Set `notifyChildSessions: true` to include |

The plugin automatically:

- Detects your terminal emulator (Ghostty, Kitty, iTerm2, WezTerm, etc.)
- Resolves nested terminals (tmux, screen) to the outer terminal for accurate focus detection
- Suppresses notifications when your terminal is the focused app
- Deduplicates rapid-fire events (1.5s window)
- Only notifies for parent sessions by default

## Configuration

Works out of the box. To customize, create `~/.config/opencode/open-notify.json`:

```json
{
  "notifyChildSessions": false,
  "sounds": {
    "idle": "Glass",
    "error": "Basso",
    "permission": "Submarine"
  },
  "quietHours": {
    "enabled": false,
    "start": "22:00",
    "end": "08:00"
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `notifyChildSessions` | boolean | `false` | Include subagent session notifications |
| `sounds.idle` | string | `"Glass"` | Sound for session completion |
| `sounds.error` | string | `"Basso"` | Sound for errors |
| `sounds.permission` | string | `"Submarine"` | Sound for permission requests |
| `sounds.question` | string | `"Submarine"` | Sound for questions (falls back to `permission`) |
| `quietHours.enabled` | boolean | `false` | Enable quiet hours |
| `quietHours.start` | string | `"22:00"` | Quiet hours start (HH:MM) |
| `quietHours.end` | string | `"08:00"` | Quiet hours end (HH:MM) |
| `terminal` | string \| null | `null` | Override terminal auto-detection |

### Available macOS sounds

Basso, Blow, Bottle, Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink

Invalid sound names in the config file will log an error at startup.

## Supported terminals

Uses [`detect-terminal`](https://github.com/jonschlinkert/detect-terminal) for auto-detection. Supports 37+ terminals including:

Ghostty, Kitty, iTerm2, WezTerm, Alacritty, Hyper, Terminal.app, Warp, VS Code integrated terminal, and more.

**Works inside tmux and screen** — when running inside tmux or screen, the plugin queries the session manager to identify the outer terminal and perform accurate focus detection.

## Development

```bash
bun install
bun run build
bun run typecheck
```

## License

MIT
