// Test the LIVE-check implementation using fake Azure responses only.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { checkModel, modelConfig, ModelCheckError } from "../scripts/check-model.mjs";

const secret = "fake-azure-key-do-not-print";
const config = modelConfig(`LLM_PROVIDER=azure\nLLM_MODEL=DeepSeek-V4.1-Flash\nAZURE_OPENAI_BASE_URL=https://lab-coding.openai.azure.com/openai/v1\nAZURE_OPENAI_API_KEY=${secret}\nTEAM_A_GITHUB_TOKEN=github_pat_never_forward_this\n`);

function sse(delta, finish) {
  const chunk = (value, reason) => ({ id: "model-check", object: "chat.completion.chunk", model: config.model.id,
    choices: [{ index: 0, delta: value, finish_reason: reason }] });
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, finish))}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } });
}
function docCall() {
  return sse({ role: "assistant", tool_calls: [{ index: 0, id: "check-docs", type: "function",
    function: { name: "read_docs", arguments: JSON.stringify({ topic: "README", offset: 1, limit: 1 }) } }] }, "tool_calls");
}

test("model preflight extracts only Azure settings, never forwards real GitHub tokens, and has no fallback", () => {
  assert.equal(config.apiKey, secret);
  assert.equal(config.githubToken, "model-check-has-no-git-access");
  assert.equal(config.repository, "https://github.com/example/model-check-only.git");
  assert.ok(!JSON.stringify(config).includes("github_pat_never_forward_this"));
  assert.throws(() => modelConfig("LLM_PROVIDER=opencode-go\nOPENCODE_API_KEY=wrong-key\n"), ModelCheckError);
});

test("live preflight uses the real Pi/proxy serializer with just a read-only doc tool and two bounded calls", async () => {
  let calls = 0;
  const result = await checkModel(config, { fetcher: async (url, options) => {
    assert.equal(url, "https://lab-coding.openai.azure.com/openai/v1/chat/completions");
    assert.equal(options.headers["api-key"], secret);
    assert.equal(options.redirect, "error");
    assert.ok(!options.body.includes(secret));
    assert.ok(!options.body.includes("github_pat_"));
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "DeepSeek-V4.1-Flash");
    assert.equal(payload.stream, true);
    assert.deepEqual(payload.tools.map((tool) => tool.function.name), ["read_docs"]);
    assert.equal(payload.tool_choice, calls === 0 ? "auto" : "none");
    if (calls++ === 0) return docCall();
    assert.ok(payload.messages.some((message) => message.role === "tool"));
    return sse({ role: "assistant", content: "MODEL_CHECK_OK" }, "stop");
  } });
  assert.deepEqual(result, { ok: true, requests: 2, docCalls: 1, streamed: true });
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("Azure HTTP failures are actionable, never retried, and cannot echo credentials", async () => {
  for (const status of [400, 401, 403, 404, 429, 500]) {
    let calls = 0;
    await assert.rejects(checkModel(config, { fetcher: async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code: status === 404 ? "DeploymentNotFound" : secret, message: secret } }),
        { status, headers: { "content-type": "application/json" } });
    } }), (error) => {
      assert.ok(error instanceof ModelCheckError);
      assert.ok(error.message.includes(`HTTP ${status}`));
      assert.ok(!error.message.includes(secret));
      if (status === 404) assert.match(error.message, /DeploymentNotFound/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("reply without a doc tool is not mislabeled as a successful function-tool check", async () => {
  await assert.rejects(checkModel(config, { fetcher: async () => sse({ role: "assistant", content: "Hello" }, "stop") }), /Azure answered successfully.*Function-tool support/);
});

test("preflight cannot run write/Git tools even if the model requests one", async () => {
  let calls = 0;
  await assert.rejects(checkModel(config, { fetcher: async () => {
    if (calls++ === 0) return sse({ role: "assistant", tool_calls: [{ index: 0, id: "wrong-tool", type: "function",
      function: { name: "submit_bot", arguments: "{}" } }] }, "tool_calls");
    return sse({ role: "assistant", content: "Done" }, "stop");
  } }), ModelCheckError);
  assert.equal(calls, 2);
});

test("a model that ignores the final no-tools instruction cannot cause a third Azure request", async () => {
  let calls = 0;
  await assert.rejects(checkModel(config, { fetcher: async () => { calls++; return docCall(); } }), /two inference requests/);
  assert.equal(calls, 2);
});

test("preflight has a hard cancellation deadline and does not reveal transport error strings", async () => {
  await assert.rejects(checkModel(config, { timeoutMs: 100, fetcher: async (_url, options) => new Promise((_, reject) => {
    if (options.signal.aborted) reject(new Error(secret));
    else options.signal.addEventListener("abort", () => reject(new Error(secret)), { once: true });
  }) }), (error) => {
    assert.match(error.message, /timed out/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
});

test("LIVE check is a separate explicit command, never included in CI/build/config checking", async () => {
  const makefile = await readFile(new URL("../Makefile", import.meta.url), "utf8");
  assert.match(makefile, /check-model:\n\tnpm run build\n\tnode scripts\/check-model\.mjs/);
  const eventTarget = /check-event:([\s\S]*?)\n\n/.exec(makefile)[1];
  assert.ok(!eventTarget.includes("check-model"));
  for (const path of ["../.github/workflows/check.yml", "../.github/workflows/release.yml"])
    assert.ok(!(await readFile(new URL(path, import.meta.url), "utf8")).includes("make check-model"));
});
