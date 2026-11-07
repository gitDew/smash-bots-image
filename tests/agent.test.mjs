import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadConfig } from "../dist/config.js";
import { checkCode, TOOL_NAMES, DOC_TOPICS } from "../dist/shared.js";
import { BrokerClient, LocalDocs, botTools } from "../dist/tools.js";
import { createTeamSession, fixedResources, sendTextPrompt, safeText, WELCOME } from "../dist/agent.js";

export const environment = {
  TEAM_ID: "team_a", TEAM_REPO_URL: "https://github.com/example/smash-a.git",
  GITHUB_TOKEN: "test-git-secret", OPENCODE_API_KEY: "test-model-secret",
  LLM_PROVIDER: "opencode-go", LLM_MODEL: "kimi-k2.6",
};
const docs = new LocalDocs(new URL("../docs/libmelee", import.meta.url).pathname);

// All credentials here are deliberately fake. Tests never call a public service.
test("runtime configuration exposes model metadata, never real credentials", () => {
  const config = loadConfig(environment);
  assert.equal(config.publicConfig.model.baseUrl, "http://broker:8080/llm/v1");
  assert.equal(config.publicConfig.model.id, "kimi-k2.6");
  assert.ok(config.publicConfig.model.maxTokens <= 8192);
  assert.ok(!JSON.stringify(config.publicConfig).includes(config.githubToken));
  assert.ok(!JSON.stringify(config.publicConfig).includes(config.apiKey));
  for (const provider of [
    { LLM_PROVIDER: "anthropic", LLM_MODEL: "claude-sonnet-4-5", ANTHROPIC_API_KEY: "test" },
    { LLM_PROVIDER: "openai", LLM_MODEL: "gpt-4.1", OPENAI_API_KEY: "test" },
    { LLM_PROVIDER: "openrouter", LLM_MODEL: "anthropic/claude-sonnet-4.5", OPENROUTER_API_KEY: "test" },
  ]) assert.ok(loadConfig({ ...environment, ...provider }).publicConfig.model.baseUrl.startsWith("http://broker:8080/llm"));
});

test("configuration rejects arbitrary endpoints, paths, Git transports, and team mixups", () => {
  for (const url of [
    "file:///etc/passwd", "git@github.com:example/a.git", "https://evil.test/a.git",
    "https://secret@github.com/example/a.git", "https://github.com/example/a.git?token=secret",
    "https://github.com/example/a.git#secret", "https://github.com/example/../a.git",
    "https://github.com:443/example/a.git", "https://github.com.evil.test/example/a.git",
  ]) assert.throws(() => loadConfig({ ...environment, TEAM_REPO_URL: url }));
  for (const branch of ["-main", "main:evil", "main/../../etc", "main\nother", "refs/heads/main"])
    assert.throws(() => loadConfig({ ...environment, TEAM_BRANCH: branch }));
  assert.throws(() => loadConfig({ ...environment, TEAM_ID: "team_z" }));
  assert.throws(() => loadConfig({ ...environment, EXPECTED_TEAM_ID: "team_b" }));
  assert.throws(() => loadConfig({ ...environment, LLM_PROVIDER: "evil", LLM_MODEL: "anything" }));
  assert.throws(() => loadConfig({ ...environment, LLM_MODEL: "not-in-the-pinned-catalog" }));
  assert.throws(() => loadConfig({ ...environment, GITHUB_TOKEN: "" }));
  assert.throws(() => loadConfig({ ...environment, LLM_PROVIDER: "" }));
  assert.throws(() => loadConfig({ ...environment, LLM_MODEL: "" }));
});

test("bot content is bounded and must preserve exact UTF-8 bytes", () => {
  checkCode("# hello 🦊\n");
  for (const source of ["", " ", null, "abc\0", "x".repeat(32769), "\ud800", "x\n".repeat(2001)])
    assert.throws(() => checkCode(source));
});

test("documentation is strictly offline, topic-whitelisted, paginated, and literal-search only", async () => {
  assert.match(await docs.read("controller", 1, 20), /Controller/);
  assert.match(await docs.search("tilt_analog"), /controller:/);
  assert.match(await docs.search("(a+)+$"), /No matches/);
  assert.ok((await docs.search("melee")).split("\n").length <= 41);
  for (const topic of ["../AGENTS", "/proc/self/environ", "https://example.com", "README.html"])
    await assert.rejects(docs.read(topic));
  await assert.rejects(docs.read("README", 0));
  await assert.rejects(docs.read("README", 1, 201));
  for (const topic of DOC_TOPICS) assert.ok((await docs.read(topic, 1, 1)).length);
});

test("tool schemas have no system paths, URLs, branches, shell commands, or commit messages", () => {
  const tools = botTools(new BrokerClient(), docs);
  assert.deepEqual(tools.map((tool) => tool.name), [...TOOL_NAMES]);
  for (const tool of tools) {
    assert.equal(tool.parameters.additionalProperties, false);
    for (const property of ["path", "url", "repository", "branch", "command", "message"])
      assert.ok(!Object.hasOwn(tool.parameters.properties, property));
  }
  for (const name of ["save_bot", "verify_bot", "submit_bot", "read_bot"])
    assert.equal(tools.find((tool) => tool.name === name).executionMode, "sequential");
});

test("SDK loads no project config/extensions/MCP, has only six active tools, and no persistent session", async () => {
  const config = loadConfig(environment);
  const instructions = await readFile(new URL("../config/AGENTS.md", import.meta.url), "utf8");
  const session = await createTeamSession(config.publicConfig, new BrokerClient(), docs, instructions);
  try {
    assert.deepEqual(session.getActiveToolNames().sort(), [...TOOL_NAMES].sort());
    assert.deepEqual(session.agent.state.tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
    assert.equal(session.sessionFile, undefined);
    assert.equal(session.model.baseUrl, config.publicConfig.model.baseUrl);
    assert.equal((await session.modelRuntime.getAuth(session.model)).auth.apiKey, "event-proxy-placeholder");
    assert.match(session.systemPrompt, /only `bot.py`/);
    const resources = fixedResources(instructions);
    assert.equal(resources.getExtensions().extensions.length, 0);
    assert.equal(resources.getSkills().skills.length, 0);
    assert.equal(resources.getAgentsFiles().agentsFiles.length, 0);
    assert.equal(resources.getPrompts().prompts.length, 0);
  } finally { session.dispose(); }
});

test("read_bot can retrieve every line without truncating a large bot", async () => {
  const source = Array.from({ length: 1500 }, (_, index) => `# line ${index + 1}`).join("\n");
  const client = { request: async () => ({ code: source, sha256: "a".repeat(64) }) };
  const reader = botTools(client, docs).find((tool) => tool.name === "read_bot");
  for (const offset of [1, 501, 1001]) {
    const result = await reader.execute("test", { offset }, undefined, undefined, undefined);
    const text = result.content[0].text;
    assert.match(text, new RegExp(`# line ${offset}\\n`));
    assert.ok(!text.includes("Output truncated"));
    assert.match(text, offset === 1001 ? /next_offset: end/ : new RegExp(`next_offset: ${offset + 500}`));
  }
});

test("the kid UI requires only an idea and Enter, with no slash-command hints", () => {
  assert.match(WELCOME, /press Enter/);
  assert.ok(!WELCOME.includes("/"));
  assert.equal(safeText("hi\x1b]52;c;evil\x07\n🦊"), "hi]52;c;evil\n🦊");
});

test("every UI submission is literal prompt text, never a command or file expansion", async () => {
  const calls = [];
  const session = { prompt: async (text, options) => { calls.push({ text, options }); } };
  for (const text of ["Make Kirby jump", "/verify", "/submit", "/new", "/quit", "!rm -rf /", "@/proc/self/environ"])
    await sendTextPrompt(session, text);
  assert.deepEqual(calls.map((call) => call.text), ["Make Kirby jump", "/verify", "/submit", "/new", "/quit", "!rm -rf /", "@/proc/self/environ"]);
  assert.ok(calls.every((call) => call.options.expandPromptTemplates === false));
});

test("verification failure is a failed tool call so the agent repairs it itself", async () => {
  const client = { request: async () => ({ ok: false, message: "Invalid analog input", sha256: "a".repeat(64) }) };
  const tool = botTools(client, docs).find((tool) => tool.name === "verify_bot");
  await assert.rejects(tool.execute("test", {}, undefined, undefined, undefined), /Invalid analog input/);
});

test("agent instructions require automatic repair/verification/submission and child-friendly results", async () => {
  const instructions = await readFile(new URL("../config/AGENTS.md", import.meta.url), "utf8");
  assert.match(instructions, /Automatically call `verify_bot`/);
  assert.match(instructions, /automatically call `submit_bot`/);
  assert.match(instructions, /never ask the child to use commands/i);
  assert.match(instructions, /Do not display the hash/);
});
