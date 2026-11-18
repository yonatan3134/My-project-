import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { updateEnvFile } from "../panel/envfile.js";

test(".env updates keep other lines, replace values, and remove emptied ones", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "env-")), ".env");
  fs.writeFileSync(file, "# comment\nGEMINI_API_KEY=old\nBOT_PHONE=972500000001\nOTHER=keep\n");
  updateEnvFile({ GEMINI_API_KEY: "new\nINJECTED=1", BOT_PHONE: "", OWNER_PHONE: "972500000002" }, file);
  assert.equal(fs.readFileSync(file, "utf8"), "# comment\nGEMINI_API_KEY=newINJECTED=1\nOTHER=keep\nOWNER_PHONE=972500000002\n");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
