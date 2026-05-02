import type { Plugin } from "@opencode-ai/plugin";
interface NotifyConfig {
    notifyChildSessions: boolean;
    sounds: {
        idle: string;
        error: string;
        permission: string;
        question?: string;
    };
    quietHours: {
        enabled: boolean;
        start: string;
        end: string;
    };
    terminal?: string;
}
interface TerminalInfo {
    name: string | null;
    processName: string | null;
    bundleId: string | null;
}
export declare const VALID_MAC_SOUNDS: Set<string>;
export declare const DEFAULT_CONFIG: NotifyConfig;
type RecentNotifications = Map<string, number>;
export declare function resolveTerminalName(raw: string): string | null;
export declare function detectTerminalInfo(config: NotifyConfig): TerminalInfo;
export declare function isQuietHours(config: NotifyConfig): boolean;
export declare function escapeAppleScriptString(str: string): string;
export declare function toNonEmptyString(value: unknown): string | null;
export declare function shouldSendDedupedNotification(recentNotifications: RecentNotifications, dedupeKey: string, windowMs: number, nowMs?: number): boolean;
export declare const OpenNotifyPlugin: Plugin;
export default OpenNotifyPlugin;
