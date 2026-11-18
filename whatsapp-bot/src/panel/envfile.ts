import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths.js";

export const ENV_FILE = path.join(ROOT, ".env");

/** Sets (or, with an empty value, removes) variables in the .env file, keeping every other line as it was. */
export function updateEnvFile(values: Record<string, string>, file = ENV_FILE): void {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\n+$/, "").split("\n") : [];
  const pending = new Map(Object.entries(values).map(([k, v]) => [k, v.replace(/[\r\n]/g, "").trim()]));
  const out: string[] = [];
  for (const line of lines) {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    if (key && pending.has(key)) {
      const v = pending.get(key)!;
      pending.delete(key);
      if (v) out.push(`${key}=${v}`);
      continue;
    }
    out.push(line);
  }
  for (const [k, v] of pending) if (v) out.push(`${k}=${v}`);
  fs.writeFileSync(file, out.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
