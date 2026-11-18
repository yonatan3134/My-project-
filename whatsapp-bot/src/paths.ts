import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("project root (package.json) not found");
}

export const ROOT = findRoot();
export const CONFIG_DIR = path.join(ROOT, "config");
export const DATA_DIR = process.env.BOT_DATA_DIR ? path.resolve(process.env.BOT_DATA_DIR) : path.join(ROOT, "data");
export const AUTH_DIR = path.join(DATA_DIR, "auth");
export const DB_PATH = path.join(DATA_DIR, "bot.db");
export const TMP_DIR = path.join(DATA_DIR, "tmp");
export const DRY_RUN_DIR = path.join(DATA_DIR, "dry-run");

export function ensureDirs(): void {
  for (const d of [DATA_DIR, AUTH_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });
}
