// Explicit, LIVE Azure preflight. Never run automatically during config/build/CI.
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../dist/config.js";
import { createBrokerServer } from "../dist/broker.js";
import { createTeamSession } from "../dist/agent.js";
import { BrokerClient, LocalDocs } from "../dist/tools.js";
import { HttpError } from "../dist/shared.js";
import { parseEnv, placeholder } from "./env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN_CODES = new Set(["DeploymentNotFound", "ResourceNotFound", "Unauthorized", "Forbidden",
  "BadRequest", "OperationNotSupported", "InvalidRequest", "ContentFilter", "RateLimitReached",
  "invalid_api_key", "rate_limit_exceeded", "content_filter"]);

export class ModelCheckError extends Error {}

export function modelConfig(text) {
  const env = parseEnv(text);
  if (env.LLM_PROVIDER !== "azure" || placeholder(env.AZURE_OPENAI_API_KEY))
    throw new ModelCheckError("Set the Azure model block and AZURE_OPENAI_API_KEY locally first.");
  // Do not forward real GitHub tokens/repository configuration, even to the local proxy.
  return loadConfig({
    TEAM_ID: "team_a", TEAM_REPO_URL: "https://github.com/example/model-check-only.git",
    GITHUB_TOKEN: "model-check-has-no-git-access", LLM_PROVIDER: "azure",
    LLM_MODEL: env.LLM_MODEL, LLM_THINKING: env.LLM_THINKING,
    AZURE_OPENAI_BASE_URL: env.AZURE_OPENAI_BASE_URL, AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
  });
}

function failureMessage(failure, timedOut) {
  if (timedOut) return "Live model check timed out. Check Azure availability/network access; no repositories were changed.";
  if (failure?.status) {
    const hint = failure.status === 401 || failure.status === 403 ? "Check the Azure resource key, access, and firewall." :
      failure.status === 404 ? "Check the exact deployment name and endpoint." :
      failure.status === 429 ? "Check Azure quota/rate limits." :
      failure.status === 400 ? "Check model/API/tool compatibility." : "Check Azure service availability.";
    return `Azure returned HTTP ${failure.status}${failure.code ? ` (${failure.code})` : ""}. ${hint}`;
  }
  if (failure?.budget) return "Model check stopped after two inference requests; the read-only tool loop did not finish.";
  return "Azure did not complete the streaming/doc-tool check. Check connectivity, credentials, deployment, or API compatibility.";
}

export async function checkModel(config, { fetcher = fetch, root = ROOT, timeoutMs = 180_000 } = {}) {
  if (config.model.provider !== "azure" || config.model.api !== "openai-completions")
    throw new ModelCheckError("This preflight requires Azure v1 Chat Completions.");
  let requests = 0, docCalls = 0, streamed = false, timedOut = false, failure;
  let session;
  const abort = new AbortController();
  const blocked = () => { throw new HttpError(403, "Model checks disable all bot, verification, and Git operations."); };
  const server = createBrokerServer(config, { read: blocked, save: blocked, verify: blocked, submit: blocked }, async (url, options) => {
    if (requests >= 2) { failure = { budget: true }; throw new HttpError(429, "Preflight request budget reached."); }
    const payload = JSON.parse(options.body);
    if (!Array.isArray(payload.tools) || payload.tools.length !== 1 || payload.tools[0]?.function?.name !== "read_docs")
      throw new HttpError(403, "Preflight allows only the read_docs function.");
    requests++;
    payload.tool_choice = requests === 1 ? "auto" : "none";
    const response = await fetcher(url, { ...options, body: JSON.stringify(payload),
      signal: AbortSignal.any([abort.signal, options.signal]) });
    if (!response.ok) {
      let code;
      try {
        const error = await response.clone().json();
        const value = error?.error?.code;
        if (KNOWN_CODES.has(value)) code = value;
      } catch { /* Do not print raw Azure bodies or messages, which can echo credentials. */ }
      failure = { status: response.status, code };
    }
    return response;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const timer = setTimeout(() => { timedOut = true; abort.abort(); void session?.abort(); }, timeoutMs);
  let unsubscribe;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const publicConfig = { ...config.publicConfig, model: { ...config.publicConfig.model, baseUrl: `${base}/llm/v1` } };
    session = await createTeamSession(publicConfig, new BrokerClient(base), new LocalDocs(resolve(root, "docs/libmelee")),
      "This is a connectivity check, not a bot development task. Use read_docs once, then give a short confirmation.");
    session.setActiveToolsByName(["read_docs"]);
    session.settingsManager.setRetryEnabled(false);
    session.settingsManager.setCompactionEnabled(false);
    if (session.getActiveToolNames().join() !== "read_docs") throw new ModelCheckError("Unexpected preflight tools; refusing to call Azure.");
    unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta" && event.assistantMessageEvent.delta)
        streamed = true;
      if (event.type === "tool_execution_end" && event.toolName === "read_docs" && !event.isError) docCalls++;
    });
    await session.prompt("Call read_docs with topic README, offset 1, limit 1. After its result, reply MODEL_CHECK_OK. Do not call other tools.", { expandPromptTemplates: false });
    const last = session.messages.filter((message) => message.role === "assistant").at(-1);
    if (!failure && !timedOut && streamed && !docCalls)
      throw new ModelCheckError("Azure answered successfully and streaming worked, but no read_docs call succeeded. Function-tool support is not yet verified.");
    if (failure || timedOut || !streamed || !docCalls || requests !== 2 || last?.stopReason !== "stop" || !session.getLastAssistantText()?.trim())
      throw new ModelCheckError(failureMessage(failure, timedOut));
    return { ok: true, requests, docCalls, streamed }; // No model output, endpoint, or credentials in reports.
  } catch (error) {
    if (error instanceof ModelCheckError) throw error;
    throw new ModelCheckError(failureMessage(failure, timedOut));
  } finally {
    clearTimeout(timer);
    abort.abort();
    await session?.abort();
    unsubscribe?.();
    session?.dispose();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--config")) throw new ModelCheckError("Use --config followed by the private config path.");
  let config;
  try { config = modelConfig(await readFile(resolve(args[1] || ".env.event"), "utf8")); }
  catch { throw new ModelCheckError("Azure config is missing/invalid. Run make check-event and check the model block locally."); }
  console.log("LIVE Azure check: up to two inference requests (uses model quota). Read-only docs tool; no GitHub calls or file writes.");
  await checkModel(config);
  console.log("PASS: Azure streamed a response, invoked read_docs, and accepted the tool result in a follow-up response. Credentials were not displayed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof ModelCheckError ? error.message : "Live model check failed safely.");
    process.exitCode = 1;
  });
}
