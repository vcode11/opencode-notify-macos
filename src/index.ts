import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
// @ts-expect-error - installed at runtime
import detectTerminal from "detect-terminal"

interface NotifyConfig {
  notifyChildSessions: boolean
  sounds: {
    idle: string
    error: string
    permission: string
    question?: string
  }
  quietHours: {
    enabled: boolean
    start: string
    end: string
  }
  terminal?: string
}

interface TerminalInfo {
  name: string | null
  processName: string | null
}

const VALID_MAC_SOUNDS = [
  "Basso",
  "Blow",
  "Bottle",
  "Frog",
  "Funk",
  "Glass",
  "Hero",
  "Morse",
  "Ping",
  "Pop",
  "Purr",
  "Sosumi",
  "Submarine",
  "Tink",
]

const DEFAULT_CONFIG: NotifyConfig = {
  notifyChildSessions: false,
  sounds: {
    idle: "Glass",
    error: "Basso",
    permission: "Submarine",
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
  },
}

const TERMINAL_PROCESS_NAMES: Record<string, string> = {
  ghostty: "Ghostty",
  kitty: "kitty",
  iterm: "iTerm2",
  iterm2: "iTerm2",
  wezterm: "WezTerm",
  alacritty: "Alacritty",
  terminal: "Terminal",
  apple_terminal: "Terminal",
  hyper: "Hyper",
  warp: "Warp",
  vscode: "Code",
  "vscode-insiders": "Code - Insiders",
}

async function loadConfig(): Promise<NotifyConfig> {
  const configPath = path.join(
    os.homedir(),
    ".config",
    "opencode",
    "open-notify.json",
  )

  try {
    const content = await fs.readFile(configPath, "utf8")
    const userConfig = JSON.parse(content) as Partial<NotifyConfig>
    const merged: NotifyConfig = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      sounds: { ...DEFAULT_CONFIG.sounds, ...userConfig.sounds },
      quietHours: {
        ...DEFAULT_CONFIG.quietHours,
        ...userConfig.quietHours,
      },
    }

    const allSounds = [
      merged.sounds.idle,
      merged.sounds.error,
      merged.sounds.permission,
      merged.sounds.question,
    ].filter((s): s is string => s !== undefined)

    const invalid = allSounds.filter((s) => !VALID_MAC_SOUNDS.includes(s))
    if (invalid.length > 0) {
      console.error(
        `[open-notify] Invalid sound name(s) in config: ${invalid.join(", ")}. Valid sounds: ${VALID_MAC_SOUNDS.join(", ")}`,
      )
    }

    return merged
  } catch {
    return DEFAULT_CONFIG
  }
}

async function runOsascript(script: string): Promise<string | null> {
  if (process.platform !== "darwin") return null
  try {
    const proc = Bun.spawn(["osascript", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = await new Response(proc.stdout).text()
    return output.trim()
  } catch {
    return null
  }
}

async function getFrontmostApp(): Promise<string | null> {
  return runOsascript(
    'tell application "System Events" to get name of first application process whose frontmost is true',
  )
}

async function detectTerminalInfo(
  config: NotifyConfig,
): Promise<TerminalInfo> {
  const terminalName = config.terminal || detectTerminal() || null
  if (!terminalName) {
    return { name: null, processName: null }
  }
  const processName =
    TERMINAL_PROCESS_NAMES[terminalName.toLowerCase()] || terminalName
  return { name: terminalName, processName }
}

async function isTerminalFocused(
  terminalInfo: TerminalInfo,
): Promise<boolean> {
  if (!terminalInfo.processName) return false
  if (process.platform !== "darwin") return false
  const frontmost = await getFrontmostApp()
  if (!frontmost) return false
  return frontmost.toLowerCase() === terminalInfo.processName.toLowerCase()
}

function isQuietHours(config: NotifyConfig): boolean {
  if (!config.quietHours.enabled) return false
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [startHour, startMin] = config.quietHours.start
    .split(":")
    .map(Number)
  const [endHour, endMin] = config.quietHours.end.split(":").map(Number)
  const startMinutes = startHour * 60 + startMin
  const endMinutes = endHour * 60 + endMin
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

async function isParentSession(
  client: ReturnType<typeof import("@opencode-ai/sdk").createOpencodeClient>,
  sessionID: string,
): Promise<boolean> {
  try {
    const session = await client.session.get({ path: { id: sessionID } })
    return !session.data?.parentID
  } catch {
    return true
  }
}

interface NotificationOptions {
  title: string
  message: string
  sound: string
}

function escapeAppleScriptString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .replace(/\r/g, "")
}

async function sendMacNotification(
  options: NotificationOptions,
): Promise<void> {
  const { title, message, sound } = options
  const escapedTitle = escapeAppleScriptString(title)
  const escapedMessage = escapeAppleScriptString(message)
  const escapedSound = escapeAppleScriptString(sound)

  const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name "${escapedSound}"`

  try {
    const proc = Bun.spawn(["osascript", "-e", script], {
      stdout: "ignore",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      console.error(
        `[open-notify] Notification failed (exit ${exitCode}): ${stderr.trim()}`,
      )
    }
  } catch (err) {
    console.error(`[open-notify] Notification failed: ${err}`)
  }
}

async function sendNotification(options: NotificationOptions): Promise<void> {
  if (process.platform !== "darwin") return
  await sendMacNotification(options)
}

const QUESTION_DEDUPE_WINDOW_MS = 1500
const READY_DEDUPE_WINDOW_MS = 1500
const PERMISSION_DEDUPE_WINDOW_MS = 1500

type RecentNotifications = Map<string, number>

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized
}

function shouldSendDedupedNotification(
  recentNotifications: RecentNotifications,
  dedupeKey: string,
  windowMs: number,
  nowMs = Date.now(),
): boolean {
  for (const [key, timestamp] of recentNotifications) {
    if (nowMs - timestamp >= windowMs) {
      recentNotifications.delete(key)
    }
  }
  const lastSentAt = recentNotifications.get(dedupeKey)
  if (lastSentAt !== undefined && nowMs - lastSentAt < windowMs) {
    return false
  }
  recentNotifications.set(dedupeKey, nowMs)
  return true
}

async function handleSessionIdle(
  client: ReturnType<typeof import("@opencode-ai/sdk").createOpencodeClient>,
  sessionID: string,
  config: NotifyConfig,
  terminalInfo: TerminalInfo,
): Promise<void> {
  if (!config.notifyChildSessions) {
    const isParent = await isParentSession(client, sessionID)
    if (!isParent) return
  }
  if (isQuietHours(config)) return
  if (await isTerminalFocused(terminalInfo)) return

  let sessionTitle = "Task"
  try {
    const session = await client.session.get({ path: { id: sessionID } })
    if (session.data?.title) {
      sessionTitle = session.data.title.slice(0, 50)
    }
  } catch {}

  await sendNotification({
    title: "Ready for review",
    message: sessionTitle,
    sound: config.sounds.idle,
  })
}

async function handleSessionError(
  client: ReturnType<typeof import("@opencode-ai/sdk").createOpencodeClient>,
  sessionID: string,
  error: string | undefined,
  config: NotifyConfig,
  terminalInfo: TerminalInfo,
): Promise<void> {
  if (!config.notifyChildSessions) {
    const isParent = await isParentSession(client, sessionID)
    if (!isParent) return
  }
  if (isQuietHours(config)) return
  if (await isTerminalFocused(terminalInfo)) return

  const errorMessage = error?.slice(0, 100) || "Something went wrong"
  await sendNotification({
    title: "Something went wrong",
    message: errorMessage,
    sound: config.sounds.error,
  })
}

async function handlePermissionUpdated(
  config: NotifyConfig,
  terminalInfo: TerminalInfo,
): Promise<void> {
  if (isQuietHours(config)) return
  if (await isTerminalFocused(terminalInfo)) return
  await sendNotification({
    title: "Waiting for you",
    message: "OpenCode needs your input",
    sound: config.sounds.permission,
  })
}

async function handleQuestionAsked(
  config: NotifyConfig,
  terminalInfo: TerminalInfo,
): Promise<void> {
  if (isQuietHours(config)) return
  const sound = config.sounds.question ?? config.sounds.permission
  await sendNotification({
    title: "Question for you",
    message: "OpenCode needs your input",
    sound,
  })
}

export const OpenNotifyPlugin: Plugin = async (ctx) => {
  const { client } = ctx
  const config = await loadConfig()
  const terminalInfo = await detectTerminalInfo(config)
  const recentQuestionNotifications: RecentNotifications = new Map()
  const recentReadyNotifications: RecentNotifications = new Map()
  const recentPermissionNotifications: RecentNotifications = new Map()

  const opencodeClient = client as ReturnType<
    typeof import("@opencode-ai/sdk").createOpencodeClient
  >

  return {
    "tool.execute.before": async (input: {
      tool: string
      sessionID: string
      callID: string
    }) => {
      if (input.tool === "question") {
        const dedupeKey = `question:${input.sessionID}:${input.callID}`
        if (
          shouldSendDedupedNotification(
            recentQuestionNotifications,
            dedupeKey,
            QUESTION_DEDUPE_WINDOW_MS,
          )
        ) {
          await handleQuestionAsked(config, terminalInfo)
        }
      }
    },
    event: async ({ event }: { event: Event }): Promise<void> => {
      const runtimeEvent = event as {
        type: string
        properties: Record<string, unknown>
      }

      switch (runtimeEvent.type) {
        case "session.idle": {
          const sessionID = toNonEmptyString(
            runtimeEvent.properties.sessionID,
          )
          if (sessionID) {
            const dedupeKey = `session-ready:${sessionID}`
            if (
              shouldSendDedupedNotification(
                recentReadyNotifications,
                dedupeKey,
                READY_DEDUPE_WINDOW_MS,
              )
            ) {
              await handleSessionIdle(
                opencodeClient,
                sessionID,
                config,
                terminalInfo,
              )
            }
          }
          break
        }
        case "session.error": {
          const sessionID = toNonEmptyString(
            runtimeEvent.properties.sessionID,
          )
          const error = runtimeEvent.properties.error
          const errorMessage =
            typeof error === "string" ? error : error ? String(error) : undefined
          if (sessionID) {
            await handleSessionError(
              opencodeClient,
              sessionID,
              errorMessage,
              config,
              terminalInfo,
            )
          }
          break
        }
        case "permission.updated":
        case "permission.asked": {
          const requestId = toNonEmptyString(runtimeEvent.properties.id)
          const dedupeKey = requestId
            ? `permission:request:${requestId}`
            : null
          if (
            !dedupeKey ||
            shouldSendDedupedNotification(
              recentPermissionNotifications,
              dedupeKey,
              PERMISSION_DEDUPE_WINDOW_MS,
            )
          ) {
            await handlePermissionUpdated(config, terminalInfo)
          }
          break
        }
        case "question.asked": {
          const props = runtimeEvent.properties
          const sessionID = toNonEmptyString(props.sessionID)
          const toolInfo =
            props.tool && typeof props.tool === "object"
              ? (props.tool as Record<string, unknown>)
              : undefined
          const callID = toNonEmptyString(toolInfo?.callID)
          const requestId = toNonEmptyString(props.id)
          const dedupeKey = callID
            ? `question:${sessionID}:${callID}`
            : requestId
              ? `question:${sessionID}:request:${requestId}`
              : null
          if (
            !dedupeKey ||
            shouldSendDedupedNotification(
              recentQuestionNotifications,
              dedupeKey,
              QUESTION_DEDUPE_WINDOW_MS,
            )
          ) {
            await handleQuestionAsked(config, terminalInfo)
          }
          break
        }
      }
    },
  }
}

export default OpenNotifyPlugin
