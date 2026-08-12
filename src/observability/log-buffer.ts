import { getRedis } from "../redis";
import type { LogFields } from "./logger";

/**
 * A bounded ring buffer of recent structured log entries in Redis, so the admin
 * console can render a live "logs" view without shipping to (or querying) an
 * external log aggregator. stdout remains the durable sink; this is a convenience
 * tail, capped in size and best-effort — capturing must never throw into a log
 * call, and a Redis outage simply yields an empty tail.
 */

const KEY = "logs:recent";
const MAX_ENTRIES = 1000;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  msg: string;
  time: string;
  fields: LogFields;
};

/** Push one entry onto the ring (newest first), trimming to {@link MAX_ENTRIES}. */
export const captureLog = (level: LogLevel, msg: string, fields: LogFields): void => {
  const entry: LogEntry = { level, msg, time: new Date().toISOString(), fields };
  try {
    const redis = getRedis();
    redis
      .multi()
      .lpush(KEY, JSON.stringify(entry))
      .ltrim(KEY, 0, MAX_ENTRIES - 1)
      .exec()
      .catch(() => {});
  } catch {
    // Redis unavailable — the tail is a convenience, not a hard dependency.
  }
};

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type RecentLogsOptions = { level?: LogLevel; limit?: number };

/** Most-recent-first log entries, optionally filtered to a minimum level. */
export const recentLogs = async (opts: RecentLogsOptions = {}): Promise<LogEntry[]> => {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), MAX_ENTRIES);
  let raw: string[];
  try {
    raw = await getRedis().lrange(KEY, 0, MAX_ENTRIES - 1);
  } catch {
    return [];
  }
  const min = opts.level ? LEVEL_RANK[opts.level] : 0;
  const out: LogEntry[] = [];
  for (const line of raw) {
    let entry: LogEntry;
    try {
      entry = JSON.parse(line) as LogEntry;
    } catch {
      continue;
    }
    if (LEVEL_RANK[entry.level] >= min) out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
};
