/** Turns the bot's JSON log lines into short readable lines: journalctl ... | node dist/cli/pretty.js */
import readline from "node:readline";

const LEVELS: Record<number, string> = { 10: "trace", 20: "debug", 30: "info ", 40: "WARN ", 50: "ERROR", 60: "FATAL" };
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  try {
    const { level, time, msg, ...rest } = JSON.parse(line) as { level: number; time: string; msg?: string; [k: string]: unknown };
    const clock = new Date(time).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour12: false });
    const extra = Object.keys(rest).length > 0 ? `  ${JSON.stringify(rest)}` : "";
    console.log(`${clock} ${LEVELS[level] ?? level} ${msg ?? ""}${extra}`);
  } catch {
    console.log(line);
  }
});
