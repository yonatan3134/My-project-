/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import fs from "node:fs";
import path from "node:path";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);

// Remotion normally downloads its own tested browser (npx remotion browser ensure).
// Where that download is blocked, fall back to a pre-installed headless shell
// so renders still work. scripts/setup.sh turns the fallback off while it
// downloads, or "ensure" would find the fallback and download nothing.
const bundledBrowser = path.join(
  process.cwd(),
  "node_modules",
  ".remotion",
  "chrome-headless-shell",
);
const preinstalledRoot = "/opt/pw-browsers";
if (
  !process.env.REMOTION_NO_BROWSER_FALLBACK &&
  !fs.existsSync(bundledBrowser) &&
  fs.existsSync(preinstalledRoot)
) {
  const shell = fs
    .readdirSync(preinstalledRoot)
    .filter((name) => name.startsWith("chromium_headless_shell-"))
    .map((name) =>
      path.join(
        preinstalledRoot,
        name,
        "chrome-headless-shell-linux64",
        "chrome-headless-shell",
      ),
    )
    .find((candidate) => fs.existsSync(candidate));
  if (shell) {
    Config.setBrowserExecutable(shell);
  }
}
