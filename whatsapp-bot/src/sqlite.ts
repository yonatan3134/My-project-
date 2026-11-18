import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType, StatementSync } from "node:sqlite";

/**
 * Node's built-in SQLite, so there is no native module to compile on the
 * bot's computer. Node prints an "experimental" notice when it loads; that
 * one notice is hidden, every other warning still shows.
 */
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message)) return;
  console.warn(`${w.name}: ${w.message}`);
});
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export type Param = string | number | bigint | null | Uint8Array;
type Row = Record<string, unknown>;

export class Statement {
  constructor(private s: StatementSync) {}

  run(...args: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.s.run(...args);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  /** rows come back as plain objects */
  get(...args: Param[]): unknown {
    const r = this.s.get(...args) as Row | undefined;
    return r ? { ...r } : undefined;
  }

  all(...args: Param[]): unknown[] {
    return (this.s.all(...args) as Row[]).map((r) => ({ ...r }));
  }
}

export class Database {
  private raw: DatabaseSyncType;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
  }

  prepare(sql: string): Statement {
    return new Statement(this.raw.prepare(sql));
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  pragma(setting: string): void {
    this.raw.exec(`PRAGMA ${setting}`);
  }

  transaction(fn: () => void): () => void {
    return () => {
      this.raw.exec("BEGIN");
      try {
        fn();
        this.raw.exec("COMMIT");
      } catch (err) {
        this.raw.exec("ROLLBACK");
        throw err;
      }
    };
  }

  close(): void {
    this.raw.close();
  }
}
