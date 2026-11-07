// Actual Compose raw-env loading, using synthetic values only, with no network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "smash-env-smoke-"));
const key = 'test-key-$literal#hash=equals-and-"quotes"';
try {
  await writeFile(join(root, "credentials.env"), `OPENCODE_API_KEY=${key}\n`, { mode: 0o600 });
  await writeFile(join(root, "runtime.env"), "# No secrets/interpolation source.\n");
  await writeFile(join(root, "compose.yaml"), JSON.stringify({ services: { probe: {
    image: `${process.env.IMAGE_PREFIX || "smash-bots"}:broker-${process.env.IMAGE_TAG || "dev"}`,
    env_file: [{ path: "credentials.env", format: "raw" }],
    read_only: true, network_mode: "none", cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"], user: "1000:1000", pids_limit: 16, mem_limit: "512m",
    entrypoint: ["node", "-e", `require('node:assert/strict').equal(process.env.OPENCODE_API_KEY, Buffer.from('${Buffer.from(key).toString("base64")}', 'base64').toString()); console.log('Literal raw credential loading verified.');`],
  } } }));
  const output = execFileSync("docker", ["compose", "--env-file", "runtime.env", "--project-name", `smash-env-${process.pid}`, "run", "--rm", "--no-deps", "--pull", "never", "probe"], {
    cwd: root, env: { ...process.env, OPENCODE_API_KEY: "wrong-inherited-value" }, encoding: "utf8",
  });
  assert.match(output, /Literal raw credential loading verified/);
  console.log("Compose loads literal $/#/quotes without revealing or interpolating credentials.");
} finally {
  await rm(root, { recursive: true, force: true });
}
