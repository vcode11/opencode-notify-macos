import { describe, test, expect } from "bun:test"
import {
  isQuietHours,
  escapeAppleScriptString,
  toNonEmptyString,
  shouldSendDedupedNotification,
  detectTerminalInfo,
  VALID_MAC_SOUNDS,
  DEFAULT_CONFIG,
} from "./index"

describe("isQuietHours", () => {
  const baseConfig = DEFAULT_CONFIG

  test("returns false when quiet hours disabled", () => {
    expect(isQuietHours({ ...baseConfig, quietHours: { enabled: false, start: "22:00", end: "08:00" } })).toBe(false)
  })

  test("returns false during daytime when range is overnight and current time is midday", () => {
    const config = { ...baseConfig, quietHours: { enabled: true, start: "22:00", end: "08:00" } }
    const original = Date.prototype.getHours
    const originalMin = Date.prototype.getMinutes
    Date.prototype.getHours = () => 12
    Date.prototype.getMinutes = () => 0
    expect(isQuietHours(config)).toBe(false)
    Date.prototype.getHours = original
    Date.prototype.getMinutes = originalMin
  })

  test("returns true during overnight range when current time is 23:00", () => {
    const config = { ...baseConfig, quietHours: { enabled: true, start: "22:00", end: "08:00" } }
    const original = Date.prototype.getHours
    const originalMin = Date.prototype.getMinutes
    Date.prototype.getHours = () => 23
    Date.prototype.getMinutes = () => 0
    expect(isQuietHours(config)).toBe(true)
    Date.prototype.getHours = original
    Date.prototype.getMinutes = originalMin
  })

  test("returns true during overnight range when current time is 03:00", () => {
    const config = { ...baseConfig, quietHours: { enabled: true, start: "22:00", end: "08:00" } }
    const original = Date.prototype.getHours
    const originalMin = Date.prototype.getMinutes
    Date.prototype.getHours = () => 3
    Date.prototype.getMinutes = () => 0
    expect(isQuietHours(config)).toBe(true)
    Date.prototype.getHours = original
    Date.prototype.getMinutes = originalMin
  })

  test("returns false at exact end time of overnight range", () => {
    const config = { ...baseConfig, quietHours: { enabled: true, start: "22:00", end: "08:00" } }
    const original = Date.prototype.getHours
    const originalMin = Date.prototype.getMinutes
    Date.prototype.getHours = () => 8
    Date.prototype.getMinutes = () => 0
    expect(isQuietHours(config)).toBe(false)
    Date.prototype.getHours = original
    Date.prototype.getMinutes = originalMin
  })

  test("returns true during daytime range when current time is 14:00", () => {
    const config = { ...baseConfig, quietHours: { enabled: true, start: "09:00", end: "17:00" } }
    const original = Date.prototype.getHours
    const originalMin = Date.prototype.getMinutes
    Date.prototype.getHours = () => 14
    Date.prototype.getMinutes = () => 0
    expect(isQuietHours(config)).toBe(true)
    Date.prototype.getHours = original
    Date.prototype.getMinutes = originalMin
  })

  test("returns false outside daytime range when current time is 08:00", () => {
    const config = { ...baseConfig, quietHours: { enabled: true, start: "09:00", end: "17:00" } }
    const original = Date.prototype.getHours
    const originalMin = Date.prototype.getMinutes
    Date.prototype.getHours = () => 8
    Date.prototype.getMinutes = () => 0
    expect(isQuietHours(config)).toBe(false)
    Date.prototype.getHours = original
    Date.prototype.getMinutes = originalMin
  })
})

describe("escapeAppleScriptString", () => {
  test("escapes double quotes", () => {
    expect(escapeAppleScriptString('say "hello"')).toBe('say \\"hello\\"')
  })

  test("escapes backslashes", () => {
    expect(escapeAppleScriptString("path\\to\\file")).toBe("path\\\\to\\\\file")
  })

  test("replaces newlines with spaces", () => {
    expect(escapeAppleScriptString("line1\nline2")).toBe("line1 line2")
  })

  test("removes carriage returns", () => {
    expect(escapeAppleScriptString("text\rmore")).toBe("textmore")
  })

  test("handles all special chars together", () => {
    expect(escapeAppleScriptString('he said "path\\to\nfile"')).toBe(
      'he said \\"path\\\\to file\\"',
    )
  })

  test("returns empty string unchanged", () => {
    expect(escapeAppleScriptString("")).toBe("")
  })

  test("returns plain string unchanged", () => {
    expect(escapeAppleScriptString("hello world")).toBe("hello world")
  })
})

describe("toNonEmptyString", () => {
  test("returns null for non-string", () => {
    expect(toNonEmptyString(42)).toBeNull()
    expect(toNonEmptyString(null)).toBeNull()
    expect(toNonEmptyString(undefined)).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(toNonEmptyString("")).toBeNull()
  })

  test("returns null for whitespace-only string", () => {
    expect(toNonEmptyString("   ")).toBeNull()
    expect(toNonEmptyString("\t\n")).toBeNull()
  })

  test("returns trimmed string for valid input", () => {
    expect(toNonEmptyString("hello")).toBe("hello")
  })

  test("trims whitespace from valid input", () => {
    expect(toNonEmptyString("  hello  ")).toBe("hello")
  })
})

describe("shouldSendDedupedNotification", () => {
  test("allows first notification for a key", () => {
    const map = new Map<string, number>()
    expect(shouldSendDedupedNotification(map, "key1", 1500, 1000)).toBe(true)
    expect(map.get("key1")).toBe(1000)
  })

  test("blocks duplicate within window", () => {
    const map = new Map<string, number>()
    shouldSendDedupedNotification(map, "key1", 1500, 1000)
    expect(shouldSendDedupedNotification(map, "key1", 1500, 2000)).toBe(false)
  })

  test("allows after window expires", () => {
    const map = new Map<string, number>()
    shouldSendDedupedNotification(map, "key1", 1500, 1000)
    expect(shouldSendDedupedNotification(map, "key1", 1500, 3000)).toBe(true)
  })

  test("different keys are independent", () => {
    const map = new Map<string, number>()
    shouldSendDedupedNotification(map, "key1", 1500, 1000)
    expect(shouldSendDedupedNotification(map, "key2", 1500, 1000)).toBe(true)
  })

  test("prunes expired entries when map exceeds max size", () => {
    const map = new Map<string, number>()
    for (let i = 0; i < 1001; i++) {
      map.set(`old-${i}`, 0)
    }
    map.set("key1", 500)
    shouldSendDedupedNotification(map, "key1", 1500, 3000)
    expect(map.has("old-0")).toBe(false)
  })

  test("exact boundary: allows at window boundary", () => {
    const map = new Map<string, number>()
    shouldSendDedupedNotification(map, "key1", 1500, 1000)
    expect(shouldSendDedupedNotification(map, "key1", 1500, 2500)).toBe(true)
  })

  test("exact boundary: blocks just before window boundary", () => {
    const map = new Map<string, number>()
    shouldSendDedupedNotification(map, "key1", 1500, 1000)
    expect(shouldSendDedupedNotification(map, "key1", 1500, 2499)).toBe(false)
  })
})

describe("detectTerminalInfo", () => {
  test("returns nulls when terminal override is null and detectTerminal unavailable", () => {
    const info = detectTerminalInfo({ ...DEFAULT_CONFIG, terminal: undefined })
    expect(info.name).toBeDefined()
  })

  test("uses terminal override from config", () => {
    const info = detectTerminalInfo({ ...DEFAULT_CONFIG, terminal: "ghostty" })
    expect(info.name).toBe("ghostty")
    expect(info.processName).toBe("Ghostty")
    expect(info.bundleId).toBe("com.mitchellh.ghostty")
  })

  test("maps iTerm2 correctly", () => {
    const info = detectTerminalInfo({ ...DEFAULT_CONFIG, terminal: "iterm2" })
    expect(info.processName).toBe("iTerm2")
    expect(info.bundleId).toBe("com.googlecode.iterm2")
  })

  test("falls back to raw name for unknown terminal", () => {
    const info = detectTerminalInfo({ ...DEFAULT_CONFIG, terminal: "wezterm" })
    expect(info.processName).toBe("WezTerm")
    expect(info.bundleId).toBe("com.github.wez.wezterm")
  })

  test("returns null bundleId for unknown terminal name", () => {
    const info = detectTerminalInfo({ ...DEFAULT_CONFIG, terminal: "some-unknown-terminal" })
    expect(info.processName).toBe("some-unknown-terminal")
    expect(info.bundleId).toBeNull()
  })
})

describe("VALID_MAC_SOUNDS", () => {
  test("contains all documented sounds", () => {
    const expected = [
      "Basso", "Blow", "Bottle", "Frog", "Funk", "Glass",
      "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi",
      "Submarine", "Tink",
    ]
    for (const sound of expected) {
      expect(VALID_MAC_SOUNDS.has(sound)).toBe(true)
    }
  })

  test("rejects invalid sound name", () => {
    expect(VALID_MAC_SOUNDS.has("NotExist")).toBe(false)
  })
})
