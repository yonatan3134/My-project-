import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Baileys is very chatty; keep its own logger at warn unless debugging. */
export const waLogger = logger.child({ mod: "wa" }, { level: process.env.WA_LOG_LEVEL ?? "warn" });
