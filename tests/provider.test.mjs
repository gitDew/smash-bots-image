import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { loadConfig } from "../dist/config.js";
import { createBrokerServer } from "../dist/broker.js";
import { createTeamSession } from "../dist/agent.js";
import { BrokerClient, LocalDocs } from "../dist/tools.js";
import { TOOL_NAMES } from "../dist/shared.js";

function sse(events) {
  return events.map(([event, data]) => `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`).join("");
}
function completion(model) {
  return sse([
    [null, { id: "test", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: "Hello team!" }, finish_reason: null }] }],
    [null, { id: "test", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }],
    [null, "[DONE]"],
  ]);
}
function anthropic(model) {
  return sse([
    ["message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello team!" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
    ["message_stop", { type: "message_stop" }],
  ]);
}
function responses(model) {
  const item = { id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello team!", annotations: [] }] };
  return sse([
    ["response.created", { type: "response.created", response: { id: "resp_test", object: "response", model, status: "in_progress", output: [] } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } }],
    ["response.content_part.added", { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }],
    ["response.output_text.delta", { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "Hello team!" }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }],
    ["response.completed", { type: "response.completed", response: { id: "resp_test", object: "response", model, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: { cached_tokens: 0 } } } }],
  ]);
}

for (const provider of [
  { LLM_PROVIDER: "opencode-go", LLM_MODEL: "kimi-k2.6", OPENCODE_API_KEY: "real-key-only-in-broker" },
  { LLM_PROVIDER: "anthropic", LLM_MODEL: "claude-sonnet-4-5", ANTHROPIC_API_KEY: "real-key-only-in-broker" },
  { LLM_PROVIDER: "openai", LLM_MODEL: "gpt-4.1", OPENAI_API_KEY: "real-key-only-in-broker" },
  { LLM_PROVIDER: "azure", LLM_MODEL: "DeepSeek-V4.1-Flash", AZURE_OPENAI_BASE_URL: "https://lab-coding.openai.azure.com/openai/v1", AZURE_OPENAI_API_KEY: "real-key-only-in-broker" },
]) {
  test(`Pi SDK streams ${provider.LLM_PROVIDER} through the fixed proxy with credential substitution`, async (t) => {
    const config = loadConfig({ TEAM_ID: "team_a", TEAM_REPO_URL: "https://github.com/example/a.git", GITHUB_TOKEN: "fake-git-token", ...provider });
    let requests = 0;
    const prompt = "!touch /etc/never @/proc/self/environ — say hello, do not use tools";
    const server = createBrokerServer(config, {}, async (url, options) => {
      requests++;
      const suffix = { "openai-completions": "/chat/completions", "anthropic-messages": "/v1/messages", "openai-responses": "/responses" }[config.model.api];
      assert.equal(url, config.model.baseUrl.replace(/\/$/, "") + suffix);
      assert.equal(options.redirect, "error");
      assert.ok(!JSON.stringify(options.headers).includes("fake-git-token"));
      assert.ok(JSON.stringify(options.headers).includes("real-key-only-in-broker"));
      assert.ok(!JSON.stringify(options.headers).includes("event-proxy-placeholder"));
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, config.model.id);
      if (provider.LLM_PROVIDER === "azure") {
        assert.equal(options.headers["api-key"], "real-key-only-in-broker");
        assert.equal(options.headers.authorization, undefined);
        assert.equal(url, "https://lab-coding.openai.azure.com/openai/v1/chat/completions");
        assert.equal(payload.model, "DeepSeek-V4.1-Flash");
        assert.equal(payload.reasoning_effort, undefined); // Deployment defaults, not guessed vendor controls.
        assert.equal(payload.thinking, undefined);
        assert.equal(payload.store, undefined);
        assert.ok(!payload.messages.some((message) => message.role === "developer"));
      }
      assert.ok(options.body.includes(prompt)); // literal text, not shell/file expansion
      const names = payload.tools.map((tool) => tool.function?.name || tool.name).sort();
      assert.deepEqual(names, [...TOOL_NAMES].sort());
      const body = config.model.api === "anthropic-messages" ? anthropic(config.model.id) : config.model.api === "openai-responses" ? responses(config.model.id) : completion(config.model.id);
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}`;
    // Test-only loopback model endpoint. Production metadata is fixed at broker:8080.
    const publicConfig = { ...config.publicConfig, model: { ...config.publicConfig.model, baseUrl: config.model.api === "anthropic-messages" ? `${url}/llm` : `${url}/llm/v1` } };
    const session = await createTeamSession(publicConfig, new BrokerClient(url), new LocalDocs(new URL("../docs/libmelee", import.meta.url).pathname), "Help with bot.py only.");
    try {
      await session.prompt(prompt, { expandPromptTemplates: false });
      assert.equal(session.getLastAssistantText(), "Hello team!");
      assert.equal(requests, 1);
    } finally { session.dispose(); }
  });
}
