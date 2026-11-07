// Run in a credential-free broker-image helper attached only to the job volume.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { VerificationQueue } from "/opt/smash/dist/verification.js";

for (const key of ["GITHUB_TOKEN", "OPENCODE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"])
  assert.equal(process.env[key], undefined);

const source = await readFile("/opt/smash/templates/bot.py", "utf8");
const queue = new VerificationQueue("/jobs", 30_000);
const result = await queue.verify(source);
assert.equal(result.ok, true, result.message);
assert.equal(result.checks, 9360);

for (const [name, code] of [
  ["syntax", "class Bot(:"],
  ["network import", "import socket\n" + source],
  ["file access", source.replace("self.port = port", "self.port = port\n        open('/tmp/evil', 'w')")],
  ["invalid character", source.replace("return melee.Character.FOX", "return melee.Character.NANA")],
  ["runtime API typo", source.replace("me.position.x", "me.nonexistent")],
  ["invalid analog", source.replace("1.0 if dx > 0 else 0.0, 0.5", "99.0, 0.5")],
  ["infinite loop", source.replace("self.port = port", "self.port = port\n        while True: pass")],
  ["memory abuse", source.replace("self.port = port", "self.port = port\n        self.data = [0] * 100000000")],
]) {
  const checked = await queue.verify(code);
  assert.equal(checked.ok, false, `${name} incorrectly passed: ${checked.message}`);
  console.log(`${name}: correctly blocked`);
}
console.log("Container bot verification passed.");
