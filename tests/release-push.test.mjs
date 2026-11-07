import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
const publish = workflow.jobs["tested-images"].steps.find((step) => step.run?.includes("docker push"));

async function runMock(t, alwaysFail) {
  const directory = await mkdtemp(join(tmpdir(), "smash-push-retry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "calls");
  // Execute the actual workflow shell step with fake commands. No registry calls,
  // real credentials, sleeps, tags, or metadata writes can occur in this test.
  const mock = `set -e
    count=0
    docker() {
      printf '%s\\n' "$*" >> "$CALL_LOG"
      if [ "$1" = push ]; then
        count=$((count + 1))
        if [ "$ALWAYS_FAIL" = 1 ] || [ "$count" -eq 1 ]; then echo 'unknown blob' >&2; return 1; fi
      fi
      return 0
    }
    sleep() { printf 'sleep %s\\n' "$1" >> "$CALL_LOG"; }
    node() { printf 'metadata\\n' >> "$CALL_LOG"; }
    git() { printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n'; }
  `;
  const result = spawnSync("bash", ["-c", mock + publish.run], {
    env: { PATH: process.env.PATH, CALL_LOG: log, ALWAYS_FAIL: alwaysFail ? "1" : "0",
      PREFIX: "ghcr.io/example/test-only", VERSION: "v0.1.0", ARCH: "arm64" }, encoding: "utf8",
  });
  return { result, calls: (await readFile(log, "utf8")).trim().split("\n") };
}

test("release retries a transient push of the exact tested image, then records metadata", async (t) => {
  const { result, calls } = await runMock(t, false);
  assert.equal(result.status, 0, result.stderr);
  const pushes = calls.filter((line) => line.startsWith("push "));
  assert.equal(pushes.length, 4); // one retry + broker + validator
  assert.equal(pushes[0], pushes[1]);
  assert.deepEqual(calls.filter((line) => line.startsWith("sleep ")), ["sleep 10"]);
  assert.equal(calls.at(-1), "metadata");
});

test("release stops after three failed pushes and never publishes success metadata", async (t) => {
  const { result, calls } = await runMock(t, true);
  assert.equal(result.status, 1);
  assert.equal(calls.filter((line) => line.startsWith("push ")).length, 3);
  assert.deepEqual(calls.filter((line) => line.startsWith("sleep ")), ["sleep 10", "sleep 20"]);
  assert.ok(!calls.includes("metadata"));
  assert.ok(!calls.some((line) => line.includes("broker-dev"))); // stop before later images
});
