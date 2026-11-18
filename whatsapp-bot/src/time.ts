export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const dayFmt = new Map<string, Intl.DateTimeFormat>();
const hourFmt = new Map<string, Intl.DateTimeFormat>();

/** Calendar day (YYYY-MM-DD) of a timestamp in the given IANA time zone. */
export function dayKey(ts: number, tz: string): string {
  let f = dayFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFmt.set(tz, f);
  }
  return f.format(new Date(ts));
}

/** Hour of day (0-23) of a timestamp in the given IANA time zone. */
export function hourOfDay(ts: number, tz: string): number {
  let f = hourFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" });
    hourFmt.set(tz, f);
  }
  return Number(f.format(new Date(ts)));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Stable 32-bit hash of a string (FNV-1a). Used for per-channel offsets and themes. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
