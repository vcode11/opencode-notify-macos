// src/index.ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import detectTerminal from "detect-terminal";
var VALID_MAC_SOUNDS = new Set([
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
  "Tink"
]);
var DEFAULT_CONFIG = {
  notifyChildSessions: false,
  sounds: {
    idle: "Glass",
    error: "Basso",
    permission: "Submarine"
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "08:00"
  }
};
var TERMINAL_PROCESS_NAMES = {
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
  "vscode-insiders": "Code - Insiders"
};
var DEDEPE_MAP_MAX_SIZE = 1000;
var QUESTION_DEDUPE_WINDOW_MS = 1500;
var READY_DEDUPE_WINDOW_MS = 1500;
var PERMISSION_DEDUPE_WINDOW_MS = 1500;
async function loadConfig() {
  const configPath = path.join(os.homedir(), ".config", "opencode", "open-notify.json");
  try {
    const content = await fs.readFile(configPath, "utf8");
    const userConfig = JSON.parse(content);
    const merged = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      sounds: { ...DEFAULT_CONFIG.sounds, ...userConfig.sounds },
      quietHours: {
        ...DEFAULT_CONFIG.quietHours,
        ...userConfig.quietHours
      }
    };
    const allSounds = [
      merged.sounds.idle,
      merged.sounds.error,
      merged.sounds.permission,
      merged.sounds.question
    ].filter((s) => s !== undefined);
    const invalid = allSounds.filter((s) => !VALID_MAC_SOUNDS.has(s));
    if (invalid.length > 0) {
      console.error(`[open-notify] Invalid sound name(s) in config: ${invalid.join(", ")}. Valid sounds: ${[...VALID_MAC_SOUNDS].join(", ")}`);
    }
    return merged;
  } catch {
    return DEFAULT_CONFIG;
  }
}
async function runOsascript(script) {
  if (process.platform !== "darwin")
    return null;
  try {
    const proc = Bun.spawn(["osascript", "-e", script], {
      stdout: "pipe",
      stderr: "pipe"
    });
    const output = await new Response(proc.stdout).text();
    return output.trim();
  } catch {
    return null;
  }
}
async function getFrontmostApp() {
  return runOsascript('tell application "System Events" to get name of first application process whose frontmost is true');
}
function detectTerminalInfo(config) {
  let terminalName = null;
  try {
    terminalName = config.terminal || detectTerminal() || null;
  } catch {
    terminalName = config.terminal || null;
  }
  if (!terminalName) {
    return { name: null, processName: null };
  }
  const processName = TERMINAL_PROCESS_NAMES[terminalName.toLowerCase()] || terminalName;
  return { name: terminalName, processName };
}
async function isTerminalFocused(terminalInfo) {
  if (!terminalInfo.processName)
    return false;
  if (process.platform !== "darwin")
    return false;
  const frontmost = await getFrontmostApp();
  if (!frontmost)
    return false;
  return frontmost.toLowerCase() === terminalInfo.processName.toLowerCase();
}
function isQuietHours(config) {
  if (!config.quietHours.enabled)
    return false;
  const now = new Date;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMin] = config.quietHours.start.split(":").map(Number);
  const [endHour, endMin] = config.quietHours.end.split(":").map(Number);
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}
function escapeAppleScriptString(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, " ").replace(/\r/g, "");
}
async function sendNotification(options) {
  if (process.platform !== "darwin")
    return;
  const { title, message, sound } = options;
  const escapedTitle = escapeAppleScriptString(title);
  const escapedMessage = escapeAppleScriptString(message);
  const escapedSound = escapeAppleScriptString(sound);
  const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name "${escapedSound}"`;
  try {
    const proc = Bun.spawn(["osascript", "-e", script], {
      stdout: "ignore",
      stderr: "pipe"
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(`[open-notify] Notification failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  } catch (err) {
    console.error(`[open-notify] Notification failed: ${err}`);
  }
}
function toNonEmptyString(value) {
  if (typeof value !== "string")
    return null;
  const normalized = value.trim();
  if (!normalized)
    return null;
  return normalized;
}
function shouldSendDedupedNotification(recentNotifications, dedupeKey, windowMs, nowMs = Date.now()) {
  if (recentNotifications.size > DEDEPE_MAP_MAX_SIZE) {
    for (const [key, timestamp] of recentNotifications) {
      if (nowMs - timestamp >= windowMs) {
        recentNotifications.delete(key);
      }
    }
  }
  const lastSentAt = recentNotifications.get(dedupeKey);
  if (lastSentAt !== undefined && nowMs - lastSentAt < windowMs) {
    return false;
  }
  recentNotifications.set(dedupeKey, nowMs);
  return true;
}
async function shouldNotify(client, sessionID, config, terminalInfo) {
  if (isQuietHours(config))
    return false;
  if (await isTerminalFocused(terminalInfo))
    return false;
  if (!config.notifyChildSessions) {
    try {
      const session = await client.session.get({ path: { id: sessionID } });
      if (session.data?.parentID)
        return false;
    } catch {}
  }
  return true;
}
async function getSessionTitle(client, sessionID) {
  try {
    const session = await client.session.get({ path: { id: sessionID } });
    return session.data?.title?.slice(0, 50) ?? "Task";
  } catch {
    return "Task";
  }
}
async function handleSessionIdle(client, sessionID, config, terminalInfo) {
  if (!await shouldNotify(client, sessionID, config, terminalInfo))
    return;
  const sessionTitle = await getSessionTitle(client, sessionID);
  await sendNotification({
    title: "Ready for review",
    message: sessionTitle,
    sound: config.sounds.idle
  });
}
async function handleSessionError(client, sessionID, error, config, terminalInfo) {
  if (!await shouldNotify(client, sessionID, config, terminalInfo))
    return;
  const errorMessage = error?.slice(0, 100) || "Something went wrong";
  await sendNotification({
    title: "Something went wrong",
    message: errorMessage,
    sound: config.sounds.error
  });
}
async function handlePermissionUpdated(config, terminalInfo) {
  if (isQuietHours(config))
    return;
  if (await isTerminalFocused(terminalInfo))
    return;
  await sendNotification({
    title: "Waiting for you",
    message: "OpenCode needs your input",
    sound: config.sounds.permission
  });
}
async function handleQuestionAsked(config, terminalInfo) {
  if (isQuietHours(config))
    return;
  const sound = config.sounds.question ?? config.sounds.permission;
  await sendNotification({
    title: "Question for you",
    message: "OpenCode needs your input",
    sound
  });
}
var OpenNotifyPlugin = async (ctx) => {
  const { client } = ctx;
  const config = await loadConfig();
  const terminalInfo = detectTerminalInfo(config);
  const recentQuestionNotifications = new Map;
  const recentReadyNotifications = new Map;
  const recentPermissionNotifications = new Map;
  const opencodeClient = client;
  return {
    "tool.execute.before": async (input) => {
      if (input.tool === "question") {
        const dedupeKey = `question:${input.sessionID}:${input.callID}`;
        if (shouldSendDedupedNotification(recentQuestionNotifications, dedupeKey, QUESTION_DEDUPE_WINDOW_MS)) {
          await handleQuestionAsked(config, terminalInfo);
        }
      }
    },
    event: async ({ event }) => {
      const { type, properties } = event;
      switch (type) {
        case "session.idle": {
          const sessionID = toNonEmptyString(properties.sessionID);
          if (sessionID) {
            const dedupeKey = `session-ready:${sessionID}`;
            if (shouldSendDedupedNotification(recentReadyNotifications, dedupeKey, READY_DEDUPE_WINDOW_MS)) {
              await handleSessionIdle(opencodeClient, sessionID, config, terminalInfo);
            }
          }
          break;
        }
        case "session.error": {
          const sessionID = toNonEmptyString(properties.sessionID);
          const error = properties.error;
          const errorMessage = typeof error === "string" ? error : error ? String(error) : undefined;
          if (sessionID) {
            await handleSessionError(opencodeClient, sessionID, errorMessage, config, terminalInfo);
          }
          break;
        }
        case "permission.updated":
        case "permission.asked": {
          const requestId = toNonEmptyString(properties.id);
          const dedupeKey = requestId ? `permission:request:${requestId}` : null;
          if (!dedupeKey || shouldSendDedupedNotification(recentPermissionNotifications, dedupeKey, PERMISSION_DEDUPE_WINDOW_MS)) {
            await handlePermissionUpdated(config, terminalInfo);
          }
          break;
        }
        case "question.asked": {
          const sessionID = toNonEmptyString(properties.sessionID);
          const toolInfo = properties.tool && typeof properties.tool === "object" ? properties.tool : undefined;
          const callID = toNonEmptyString(toolInfo?.callID);
          const requestId = toNonEmptyString(properties.id);
          const dedupeKey = callID ? `question:${sessionID}:${callID}` : requestId ? `question:${sessionID}:request:${requestId}` : null;
          if (!dedupeKey || shouldSendDedupedNotification(recentQuestionNotifications, dedupeKey, QUESTION_DEDUPE_WINDOW_MS)) {
            await handleQuestionAsked(config, terminalInfo);
          }
          break;
        }
      }
    }
  };
};
var src_default = OpenNotifyPlugin;
export {
  src_default as default,
  OpenNotifyPlugin
};
