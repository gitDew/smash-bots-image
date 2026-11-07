import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { unzipSync, strFromU8 } from "fflate";
import { parseEnv } from "../scripts/env.mjs";
import { initEvent } from "../scripts/init-event.mjs";
import { eventConfig } from "../scripts/event-config.mjs";
import { bundleFiles, generateBundles, runtimeCompose } from "../scripts/bundles.mjs";
import { architectureMetadata, mergeMetadata } from "../scripts/release-metadata.mjs";
import { validateRelease } from "../scripts/release-format.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const template = await readFile(join(ROOT, ".env.event.example"), "utf8");
const source = await readFile(join(ROOT, "compose.yaml"), "utf8");
const modelKey = "model-key-with-$literal#value=still-literal";
const validText = template.replace("replace-with-model-api-key", modelKey).replace(/replace-with-team-([abcd])-token/g, (_, letter) => `github_pat_test_${letter}`);
const event = eventConfig(validText);
const release = {
  schema: 1, imagePrefix: event.imagePrefix, version: event.version, commit: "a".repeat(40), platforms: ["linux/amd64", "linux/arm64"],
  images: Object.fromEntries(["agent", "broker", "validator"].map((service, index) => [service, `${event.imagePrefix}:${service}-${event.version}@sha256:${String(index + 1).repeat(64)}`])),
};

async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), "smash-bundle-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("admin env values are literal, duplicate/malformed fields are rejected without exposing values", () => {
  assert.equal(parseEnv('KEY="$literal#value=not-a-command"\r\n').KEY, "$literal#value=not-a-command");
  assert.equal(parseEnv("KEY='$(echo secret)'\n").KEY, "$(echo secret)");
  for (const value of ["KEY=x\nKEY=y", "bad syntax", "KEY='unclosed", "KEY=x\0secret"])
    assert.throws(() => parseEnv(value));
});

test("master init silently preserves the existing model key and refuses to overwrite config", async (t) => {
  const root = await temp(t);
  await writeFile(join(root, ".env.event.example"), template);
  await writeFile(join(root, ".env"), `OPENCODE_API_KEY=${modelKey}\n`);
  const result = await initEvent(root);
  assert.equal(result.reusedModelKey, true);
  assert.ok(!JSON.stringify(result).includes(modelKey));
  assert.equal(parseEnv(await readFile(result.path, "utf8")).OPENCODE_API_KEY, modelKey);
  assert.equal((await stat(result.path)).mode & 0o777, 0o600);
  await assert.rejects(initEvent(root), { code: "EEXIST" });
  assert.equal(await readFile(join(root, ".env"), "utf8"), `OPENCODE_API_KEY=${modelKey}\n`);
});

test("master config validates four separate repositories/tokens and exactly three Intel + one Silicon laptop", () => {
  assert.deepEqual(event.teams.map((team) => team.platform), ["linux/amd64", "linux/amd64", "linux/amd64", "linux/arm64"]);
  for (const invalid of [
    template, validText.replace("github_pat_test_b", "github_pat_test_a"),
    validText.replace("smash-team-b.git", "smash-team-a.git"),
    validText.replace("TEAM_D_PLATFORM=linux/arm64", "TEAM_D_PLATFORM=linux/amd64"),
    validText.replace("github_pat_test_a", "ghp_broad-classic-token"),
    validText.replace("IMAGE_TAG=v0.1.0", "IMAGE_TAG=latest"),
    validText + "PI_CODING_AGENT_DIR=/untrusted\n",
  ]) assert.throws(() => eventConfig(invalid));
});

test("release refs must pin all three images to the expected version, registry, and both architectures", () => {
  assert.equal(validateRelease(release, event.imagePrefix, event.version), release);
  for (const invalid of [
    { ...release, platforms: ["linux/arm64"] },
    { ...release, version: "v9.9.9" },
    { ...release, images: { ...release.images, agent: `${event.imagePrefix}:agent-latest` } },
    { ...release, images: { ...release.images, agent: `evil.io/source:agent-${event.version}@sha256:${"1".repeat(64)}` } },
  ]) assert.throws(() => validateRelease(invalid, event.imagePrefix, event.version));
});

test("runtime Compose is image-only, digest-pinned, architecture-specific, and retains the isolation boundary", () => {
  const team = event.teams[0];
  const runtime = runtimeCompose(source, team, release);
  for (const service of Object.values(runtime.services)) {
    assert.equal(service.build, undefined);
    assert.equal(service.platform, "linux/amd64");
    assert.equal(service.read_only, true);
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"]);
    assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
  }
  assert.equal(runtime.services.broker.environment.EXPECTED_TEAM_ID, "team_a");
  assert.deepEqual(runtime.services.broker.env_file, [{ path: "credentials.env", format: "raw" }]);
  assert.equal(runtime.services.agent.env_file, undefined);
  assert.equal(runtime.services.agent.volumes, undefined);
  assert.equal(runtime.services.validator.network_mode, "none");
  assert.deepEqual(runtime.services.validator.cap_add, ["SETUID", "SETGID", "KILL"]);
  const unsafe = parse(source);
  unsafe.services.agent.volumes = ["/var/run/docker.sock:/var/run/docker.sock"];
  assert.throws(() => runtimeCompose(stringify(unsafe), team, release));
  delete unsafe.services.agent.volumes;
  unsafe.services.broker.environment.OPENCODE_API_KEY = modelKey;
  assert.throws(() => runtimeCompose(stringify(unsafe), team, release));
});

test("each folder contains only its assigned GitHub token and selected model key; launchers are manual", async () => {
  for (const [index, team] of event.teams.entries()) {
    const files = await bundleFiles(ROOT, team, release);
    assert.equal(parseEnv(files["credentials.env"]).OPENCODE_API_KEY, modelKey);
    assert.equal(parseEnv(files["credentials.env"]).GITHUB_TOKEN, `github_pat_test_${"abcd"[index]}`);
    for (const peer of "abcd") if (peer !== "abcd"[index]) assert.ok(!JSON.stringify(files).includes(`github_pat_test_${peer}`));
    for (const [name, content] of Object.entries(files)) if (name !== "credentials.env") {
      assert.ok(!content.includes(modelKey));
      assert.ok(!content.includes("github_pat_test_"));
    }
    assert.ok(!Object.keys(files).some((name) => /\.cmd$|\.command$|shortcut/i.test(name)));
    if (team.platform === "linux/arm64") {
      assert.ok(files["launch.sh"]);
      assert.equal(files["launch.ps1"], undefined);
    } else {
      assert.ok(files["launch.ps1"].includes("Invoke-Compose -Arguments"));
      assert.equal(files["launch.sh"], undefined);
    }
  }
});

test("generator writes private folders and ZIPs, handles literal keys, and preserves existing bundles", async (t) => {
  const root = await temp(t);
  const configPath = join(root, ".env.event");
  const releasePath = join(root, "release.json");
  const output = join(root, "bundles", event.version);
  await writeFile(configPath, validText, { mode: 0o600 });
  await writeFile(releasePath, JSON.stringify(release));
  const result = await generateBundles({ configPath, releasePath, output });
  assert.equal(result.teams.length, 4);
  assert.ok(!JSON.stringify(result).includes(modelKey));
  assert.equal((await readdir(output)).length, 8);
  for (const letter of "abcd") {
    const id = `team_${letter}`;
    const files = unzipSync(new Uint8Array(await readFile(join(output, `${id}.zip`))));
    assert.equal(Object.keys(files).length, 5);
    const credentials = parseEnv(strFromU8(files[`${id}/credentials.env`]));
    assert.equal(credentials.GITHUB_TOKEN, `github_pat_test_${letter}`);
    assert.equal(credentials.OPENCODE_API_KEY, modelKey);
    assert.equal((await stat(join(output, id, "credentials.env"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(output, `${id}.zip`))).mode & 0o777, 0o600);
  }
  await assert.rejects(generateBundles({ configPath, releasePath, output }), { code: "EEXIST" });
  assert.equal((await readdir(output)).length, 8);
});

test("generated Compose parses on Docker without needing build source or interpolating keys", async (t) => {
  try { execFileSync("docker", ["compose", "version"], { stdio: "ignore" }); } catch { t.skip("Docker Compose CLI not installed"); return; }
  const root = await temp(t);
  const files = await bundleFiles(ROOT, event.teams[0], release);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content, { mode: 0o600 });
  const output = execFileSync("docker", ["compose", "--env-file", "runtime.env", "config", "--format", "json"], {
    cwd: root, env: { ...process.env, OPENCODE_API_KEY: "wrong-inherited-key", IMAGE_TAG: "dev" }, encoding: "utf8",
  });
  const parsed = JSON.parse(output);
  // `compose config` escapes dollars for reserialization; raw runtime loading is
  // exercised separately by the actual container smoke test.
  assert.equal(parsed.services.broker.environment.OPENCODE_API_KEY, modelKey.replaceAll("$", () => "$$"));
  assert.ok(!Object.hasOwn(parsed.services.agent.environment, "OPENCODE_API_KEY"));
  assert.ok(!Object.hasOwn(parsed.services.validator, "environment"));
  assert.equal(parsed.services.agent.image, release.images.agent);
});

test("release manifests use both tested immutable digests and cannot merge different versions/source commits", () => {
  const calls = [];
  const run = (args) => { calls.push(args); return `Name: test\nDigest: sha256:${"a".repeat(64)}\n`; };
  const base = { imagePrefix: event.imagePrefix, version: event.version, commit: release.commit };
  const amd64 = architectureMetadata({ ...base, arch: "amd64" }, run);
  const arm64 = architectureMetadata({ ...base, arch: "arm64" }, run);
  const combined = mergeMetadata(amd64, arm64, run);
  assert.deepEqual(combined.platforms, ["linux/amd64", "linux/arm64"]);
  assert.equal(calls.filter((args) => args.includes("create")).length, 3);
  assert.ok(calls.filter((args) => args.includes("create")).every((args) => args.slice(-2).every((ref) => ref.includes("@sha256:"))));
  assert.throws(() => mergeMetadata(amd64, { ...arm64, commit: "b".repeat(40) }, run));
});

test("Git ignores private master configuration, bundles, and generated release metadata", () => {
  for (const path of [".env.event", "bundles/v0.1.0/team_a/credentials.env", "bundles/v0.1.0/team_a.zip", "release.json", "release-out/amd64.json"])
    assert.equal(execFileSync("git", ["check-ignore", path], { cwd: ROOT, encoding: "utf8" }).trim(), path);
});

test("CI publishes no credential bundles and gates manifests on both native architecture tests", async () => {
  const workflow = parse(await readFile(join(ROOT, ".github/workflows/release.yml"), "utf8"));
  assert.deepEqual(workflow.jobs["tested-images"].strategy.matrix.include.map((item) => item.runner), ["ubuntu-24.04", "ubuntu-24.04-arm"]);
  const steps = workflow.jobs["tested-images"].steps;
  const smoke = steps.findIndex((step) => step.run === "make smoke");
  const push = steps.findIndex((step) => step.run?.includes("docker push"));
  assert.ok(smoke >= 0 && smoke < push);
  assert.deepEqual(workflow.jobs.manifests.needs, ["prepare", "tested-images"]);
  assert.ok(!JSON.stringify(workflow).includes(".env.event"));
  assert.ok(!JSON.stringify(workflow).includes("credentials.env"));
  const releaseStep = workflow.jobs.manifests.steps.find((step) => step.run?.includes("gh release create"));
  assert.ok(releaseStep.run.includes('"$VERSION" release.json'));
});
