# opencode-notify-macos

## Dev commands

```bash
bun install         # install deps
bun run build       # compiles TypeScript + generates .d.ts (must run before publishing)
bun run typecheck   # tsc --noEmit
bun test            # run tests (bun:test, no --flag needed)
```

## Build artifacts

- `dist/` is generated; `dist/index.js` is the plugin entry point
- Build runs both `bun build` and `tsc --emitDeclarationOnly` (generates `.d.ts`)

## Config

- User config: `~/.config/opencode/open-notify.json`
- Default config is baked into `src/index.ts` (DEFAULT_CONFIG export)

## Architecture

- `src/entry.ts` — plugin entry point (re-exports default from `src/index.ts`)
- `src/index.ts` — all plugin logic and AppleScript notification handling
- `src/index.test.ts` — unit tests using `bun:test`

## Key constraints

- Peer deps: `@opencode-ai/plugin` and `@opencode-ai/sdk` (installed at runtime by OpenCode, not bundled)
- `detect-terminal` is external in the bundle (runtime dependency)
- Notifications only work on macOS; all AppleScript logic is guarded by `process.platform !== "darwin"` checks