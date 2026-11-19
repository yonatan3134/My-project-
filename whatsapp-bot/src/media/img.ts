import type SharpModule from "sharp";

type Sharp = typeof SharpModule;
let mod: Sharp | null | undefined;
let loadError = "";

/**
 * The image library, loaded on first use. On a device it does not support
 * (for example an Android phone without its WebAssembly build) this throws,
 * and the caller sends the post as text instead of crashing the bot.
 */
export async function loadSharp(): Promise<Sharp> {
  if (mod === undefined) {
    try {
      mod = (await import("sharp")).default;
    } catch (err) {
      mod = null;
      loadError = (err as Error).message.split("\n")[0] ?? "";
    }
  }
  if (!mod) throw new Error(`pictures are not available on this device (${loadError})`);
  return mod;
}
