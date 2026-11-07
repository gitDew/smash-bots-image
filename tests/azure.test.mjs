import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadConfig } from "../dist/config.js";
import { createBrokerServer, checkModelRequest } from "../dist/broker.js";
import { createTeamSession } from "../dist/agent.js";
import { BrokerClient, LocalDocs } from "../dist/tools.js";
import { eventConfig } from "../scripts/event-config.mjs";
import { bundleFiles } from "../scripts/bundles.mjs";
import { parseEnv } from "../scripts/env.mjs";

const AZURE = {
  TEAM_ID: "team_a", TEAM_REPO_URL: "https://github.com/gitDew/smash-team-a.git", GITHUB_TOKEN: "github_pat_fake_a",
  LLM_PROVIDER: "azure", LLM_MODEL: "DeepSeek-V4.1-Flash", LLM_THINKING: "medium",
  AZURE_OPENAI_BASE_URL: "https://lab-coding.openai.azure.com/openai/v1",
  AZURE_OPENAI_API_KEY: "fake-azure-key-private-to-broker",
};
const ROOT = new URL("../", import.meta.url).pathname;

function chunk(config, delta, reason = null) {
  return `data: ${JSON.stringify({ id: "azure-test", object: "chat.completion.chunk", model: config.model.id,
    choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
}

test("Azure uses the exact deployment ID and v1 Chat Completions, without exposing the endpoint/key to Pi", () => {
  const config = loadConfig(AZURE);
  assert.equal(config.model.provider, "azure");
  assert.equal(config.model.api, "openai-completions");
  assert.equal(config.model.id, "DeepSeek-V4.1-Flash");
  assert.equal(config.publicConfig.model.baseUrl, "http://broker:8080/llm/v1");
  assert.ok(!JSON.stringify(config.publicConfig).includes(AZURE.AZURE_OPENAI_API_KEY));
  assert.ok(!JSON.stringify(config.publicConfig).includes("lab-coding"));
  assert.equal(loadConfig({ ...AZURE, AZURE_OPENAI_BASE_URL: AZURE.AZURE_OPENAI_BASE_URL + "/" }).model.baseUrl, AZURE.AZURE_OPENAI_BASE_URL);
  assert.throws(() => checkModelRequest({ model: "deepseek-v4.1-flash" }, config)); // No case-folding/deployment substitution.
});

test("Azure cannot become an arbitrary URL proxy or fall back to another provider/model", () => {
  for (const url of [
    "http://lab-coding.openai.azure.com/openai/v1", "https://example.com/openai/v1",
    "https://lab-coding.openai.azure.com.evil.test/openai/v1", "https://secret@lab-coding.openai.azure.com/openai/v1",
    "https://lab-coding.openai.azure.com:8443/openai/v1", "https://lab-coding.openai.azure.com/openai/v1?secret=x",
    "https://lab-coding.openai.azure.com/openai/v1#fragment", "https://lab-coding.openai.azure.com/openai/v1/responses",
    "file:///etc/passwd",
  ]) assert.throws(() => loadConfig({ ...AZURE, AZURE_OPENAI_BASE_URL: url }));
  assert.throws(() => loadConfig({ ...AZURE, LLM_MODEL: "" }));
  assert.throws(() => loadConfig({ ...AZURE, LLM_MODEL: "deployment\nother" }));
  assert.throws(() => loadConfig({ ...AZURE, AZURE_OPENAI_API_KEY: "", OPENCODE_API_KEY: "do-not-use-this" }));
});

test("private event bundles retain Azure routing and contain no unused provider keys", async () => {
  const values = parseEnv(await readFile(new URL("../.env.event.example", import.meta.url), "utf8"));
  Object.assign(values, { LLM_PROVIDER: "azure", LLM_MODEL: AZURE.LLM_MODEL,
    AZURE_OPENAI_BASE_URL: AZURE.AZURE_OPENAI_BASE_URL, AZURE_OPENAI_API_KEY: AZURE.AZURE_OPENAI_API_KEY,
    OPENCODE_API_KEY: "unused-opencode-key-never-distribute" });
  for (const letter of "ABCD") values[`TEAM_${letter}_GITHUB_TOKEN`] = `github_pat_fake_${letter.toLowerCase()}`;
  const config = eventConfig(Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"));
  const release = { schema: 1, version: config.version, imagePrefix: config.imagePrefix, commit: "a".repeat(40),
    platforms: ["linux/amd64", "linux/arm64"], images: Object.fromEntries(["agent", "broker", "validator"].map((name) =>
      [name, `${config.imagePrefix}:${name}-${config.version}@sha256:${"a".repeat(64)}`])) };
  for (const team of config.teams) {
    const files = await bundleFiles(ROOT, team, release);
    const credentials = parseEnv(files["credentials.env"]);
    assert.equal(credentials.AZURE_OPENAI_API_KEY, AZURE.AZURE_OPENAI_API_KEY);
    assert.equal(credentials.AZURE_OPENAI_BASE_URL, AZURE.AZURE_OPENAI_BASE_URL);
    assert.equal(credentials.LLM_MODEL, "DeepSeek-V4.1-Flash");
    assert.equal(credentials.OPENCODE_API_KEY, undefined);
    for (const [name, data] of Object.entries(files)) if (name !== "credentials.env") {
      assert.ok(!data.includes(AZURE.AZURE_OPENAI_API_KEY));
      assert.ok(!data.includes("lab-coding"));
    }
  }
});

test("Azure streams reasoning + a bot tool call and replays its reasoning before the next model turn", async (t) => {
  const config = loadConfig(AZURE);
  let requests = 0;
  const server = createBrokerServer(config, {}, async (url, options) => {
    assert.equal(url, `${AZURE.AZURE_OPENAI_BASE_URL}/chat/completions`);
    assert.equal(options.headers["api-key"], AZURE.AZURE_OPENAI_API_KEY);
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "DeepSeek-V4.1-Flash");
    assert.equal(payload.reasoning_effort, undefined);
    let body;
    if (requests++ === 0) {
      body = chunk(config, { role: "assistant", reasoning_content: "Read the offline reference first." }) +
        chunk(config, { tool_calls: [{ index: 0, id: "azure_read", type: "function",
          function: { name: "read_docs", arguments: JSON.stringify({ topic: "README", limit: 1 }) } }] }) +
        chunk(config, {}, "tool_calls") + "data: [DONE]\n\n";
    } else {
      const previous = payload.messages.find((message) => message.role === "assistant" && message.tool_calls);
      assert.equal(previous.reasoning_content, "Read the offline reference first.");
      assert.ok(payload.messages.some((message) => message.role === "tool"));
      body = chunk(config, { role: "assistant", content: "Azure tool loop is ready." }) + chunk(config, {}, "stop") + "data: [DONE]\n\n";
    }
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const publicConfig = { ...config.publicConfig, model: { ...config.publicConfig.model, baseUrl: `${base}/llm/v1` } };
  const session = await createTeamSession(publicConfig, new BrokerClient(base), new LocalDocs(`${ROOT}/docs/libmelee`), "Use bot tools only.");
  try {
    await session.prompt("Read the reference and reply.", { expandPromptTemplates: false });
    assert.equal(session.getLastAssistantText(), "Azure tool loop is ready.");
    assert.equal(requests, 2);
    assert.equal((await session.modelRuntime.getAuth(session.model)).auth.apiKey, "event-proxy-placeholder");
  } finally { session.dispose(); }
});
