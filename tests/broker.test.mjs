import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { loadConfig } from "../dist/config.js";
import { BotService, createBrokerServer, checkModelRequest } from "../dist/broker.js";
import { VerificationQueue } from "../dist/verification.js";
import { sha256, TOOL_NAMES } from "../dist/shared.js";

const environment = { TEAM_ID: "team_a", TEAM_REPO_URL: "https://github.com/example/a.git", GITHUB_TOKEN: "fake-git-secret", OPENCODE_API_KEY: "fake-model-secret", LLM_PROVIDER: "opencode-go", LLM_MODEL: "kimi-k2.6" };
const starter = await readFile(new URL("../templates/bot.py", import.meta.url), "utf8");

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "smash-broker-test-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(join(directory, "bot.py"), starter);
  return directory;
}
async function serve(t, service, fetcher) {
  const config = loadConfig(environment);
  const server = createBrokerServer(config, service, fetcher);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { config, server, url };
}
const verified = (code) => ({ ok: true, sha256: sha256(code), message: "Passed." });

test("save is compare-and-swap; failed verification never reaches Git", async (t) => {
  const directory = await temporary(t);
  let publishes = 0;
  const service = new BotService(directory, { publish: async () => { publishes++; } }, {
    verify: async (code) => ({ ...verified(code), ok: false, message: "SyntaxError in bot.py" }),
  });
  await assert.rejects(service.save("# changed", "wrong"), /Read it again/);
  assert.equal((await service.read()).code, starter);
  const saved = await service.save("# changed", sha256(starter));
  assert.equal(saved.sha256, sha256("# changed"));
  await assert.rejects(service.submit(), /SyntaxError/);
  assert.equal(publishes, 0);
  assert.equal((await service.read()).code, "# changed");
});

test("submit always validates the exact committed snapshot and serializes saves across validation", async (t) => {
  const directory = await temporary(t);
  let release;
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  const published = [];
  const service = new BotService(directory, {
    publish: async (code) => { published.push(code); return { commit: "abc", message: "Published" }; },
  }, { verify: async (code) => { began(); await pending; return verified(code); } });
  const submission = service.submit();
  await started;
  const save = service.save("# next draft", sha256(starter));
  await sleep(20);
  assert.equal(await readFile(join(directory, "bot.py"), "utf8"), starter);
  release();
  await submission;
  await save;
  assert.deepEqual(published, [starter]);
  assert.equal((await service.read()).code, "# next draft");
});

test("a validator hash mismatch fails closed", async (t) => {
  const directory = await temporary(t);
  const service = new BotService(directory, { publish: async () => assert.fail("No publish allowed") }, {
    verify: async () => ({ ok: true, sha256: "not-this-code", message: "Passed" }),
  });
  await assert.rejects(service.submit(), /wrong snapshot/);
});

test("HTTP operations reject added paths/repos/branches and expose no secrets or generic proxy", async (t) => {
  const directory = await temporary(t);
  const service = new BotService(directory, { publish: async () => ({ commit: "a".repeat(40), message: "Published" }) }, { verify: async (code) => verified(code) });
  let modelRequests = 0;
  const { url, config } = await serve(t, service, async () => {
    modelRequests++;
    return new Response(config.apiKey, { status: 401 });
  });
  const publicConfig = await (await fetch(`${url}/config`)).text();
  assert.ok(!publicConfig.includes(config.apiKey));
  assert.ok(!publicConfig.includes(config.githubToken));
  for (const path of ["/etc/passwd", "/bot/../../proc/self/environ", "/llm/v1/models", "/proxy?url=https://evil.test", "/bot/submit?branch=evil"])
    assert.equal((await fetch(`${url}${path}`)).status, 404);
  for (const path of ["verify", "submit"]) {
    const response = await fetch(`${url}/bot/${path}`, { method: "POST", body: JSON.stringify({ repository: "evil" }) });
    assert.equal(response.status, 400);
  }
  const badSave = await fetch(`${url}/bot/save`, { method: "POST", body: JSON.stringify({ code: "# evil", expected_sha256: sha256(starter), path: "/etc/passwd" }) });
  assert.equal(badSave.status, 400);
  assert.equal((await service.read()).code, starter);
  assert.equal(modelRequests, 0);
  const modelResponse = await fetch(`${url}/llm/v1/chat/completions`, { method: "POST", body: JSON.stringify({ model: config.model.id, messages: [] }) });
  assert.equal(modelResponse.status, 401);
  assert.ok(!(await modelResponse.text()).includes(config.apiKey));
});

test("server-side web/search/MCP/shell tools and alternate models cannot cross the model proxy", () => {
  const config = loadConfig(environment);
  for (const body of [
    { model: "other-model" },
    { model: config.model.id, tools: [{ type: "web_search" }] },
    { model: config.model.id, tools: [{ type: "function", function: { name: "bash" } }] },
    { model: config.model.id, plugins: [{ id: "web" }] },
    { model: config.model.id, web_search_options: {} },
    { model: config.model.id, mcp_servers: [] },
    { model: config.model.id, container: {} },
  ]) assert.throws(() => checkModelRequest(body, config));
  assert.ok(checkModelRequest({ model: config.model.id, tools: TOOL_NAMES.map((name) => ({ type: "function", function: { name } })) }, config));
});

test("volume queue uses exact hashes, hides job files from the bot UID, and cleans up", async (t) => {
  const directory = await temporary(t);
  const jobs = join(directory, "jobs");
  await mkdir(jobs);
  const queue = new VerificationQueue(jobs, 1000);
  const resultPromise = queue.verify(starter);
  let job;
  while (!job) { job = (await readdir(jobs))[0]; if (!job) await sleep(10); }
  const requestPath = join(jobs, job, "request.json");
  while (true) { try { await stat(requestPath); break; } catch { await sleep(10); } }
  assert.equal((await stat(join(jobs, job))).mode & 0o777, 0o770);
  assert.equal((await stat(requestPath)).mode & 0o777, 0o640);
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  assert.equal(request.code, starter);
  assert.equal(request.sha256, sha256(starter));
  await writeFile(join(jobs, job, "result.json"), JSON.stringify(verified(starter)));
  assert.equal((await resultPromise).ok, true);
  assert.deepEqual(await readdir(jobs), []);
});

test("an absent validator times out without an unsafe host-Python fallback", async (t) => {
  const directory = await temporary(t);
  const jobs = join(directory, "jobs");
  await mkdir(jobs);
  await assert.rejects(new VerificationQueue(jobs, 150).verify(starter), /Nothing was published/);
  assert.deepEqual(await readdir(jobs), []);
});
