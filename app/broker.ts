import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { loadConfig, type BrokerConfig } from "./config.js";
import { BotRepository, createGitRunner } from "./git.js";
import { VerificationQueue } from "./verification.js";
import {
  atomicWrite, checkCode, exactObject, HttpError, Mutex, sha256, TOOL_NAMES,
  type BotSnapshot, type Verification,
} from "./shared.js";

export class BotService {
  private mutex = new Mutex();
  constructor(
    private state: string,
    private repository: Pick<BotRepository, "publish">,
    private verifier: { verify(code: string): Promise<Verification> },
  ) {}

  read(): Promise<BotSnapshot> {
    return this.mutex.run(async () => {
      const code = await readFile(join(this.state, "bot.py"), "utf8");
      checkCode(code);
      return { code, sha256: sha256(code) };
    });
  }

  save(code: unknown, expectedHash: unknown): Promise<{ sha256: string; message: string }> {
    return this.mutex.run(async () => {
      checkCode(code);
      const current = await readFile(join(this.state, "bot.py"), "utf8");
      if (typeof expectedHash !== "string" || expectedHash !== sha256(current)) {
        throw new HttpError(409, "Bot changed since read_bot. Read it again before saving.");
      }
      await atomicWrite(join(this.state, "bot.py"), code);
      return { sha256: sha256(code), message: "Draft saved. It has not been submitted yet." };
    });
  }

  verify(): Promise<Verification> {
    return this.mutex.run(async () => {
      const code = await readFile(join(this.state, "bot.py"), "utf8");
      return this.verifier.verify(code);
    });
  }

  submit(): Promise<{ commit: string; message: string }> {
    return this.mutex.run(async () => {
      const code = await readFile(join(this.state, "bot.py"), "utf8");
      // Always verify this exact snapshot again; a previous success is not a bypass.
      const result = await this.verifier.verify(code);
      if (result.sha256 !== sha256(code)) throw new HttpError(503, "Validator returned the wrong snapshot. Nothing was published.");
      if (!result.ok) throw new HttpError(422, result.message);
      return this.repository.publish(code);
    });
  }
}

async function jsonBody(request: IncomingMessage, maximum = 128 * 1024): Promise<unknown> {
  const buffers: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximum) throw new HttpError(413, "Request is too large.");
    buffers.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(buffers).toString("utf8")); }
  catch { throw new HttpError(400, "Expected a JSON request body."); }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

export function checkModelRequest(body: unknown, config: BrokerConfig): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Expected a model request.");
  const payload = body as Record<string, unknown>;
  if (payload.model !== config.model.id) throw new HttpError(403, "Only the configured model is allowed.");
  for (const key of ["plugins", "web_search_options", "mcp_servers", "container", "functions"]) {
    if (Object.hasOwn(payload, key)) throw new HttpError(403, "Server-side web, shell, and external tools are disabled.");
  }
  if (payload.tools !== undefined) {
    if (!Array.isArray(payload.tools)) throw new HttpError(400, "Invalid tool declarations.");
    for (const declaration of payload.tools) {
      if (!declaration || typeof declaration !== "object") throw new HttpError(400, "Invalid tool declaration.");
      const tool = declaration as { type?: string; name?: string; function?: { name?: string } };
      const name = config.model.api === "openai-completions" ? tool.function?.name : tool.name;
      const validType = config.model.api === "anthropic-messages"
        ? tool.type === undefined || tool.type === "custom" : tool.type === "function";
      if (!validType || !TOOL_NAMES.includes(name as (typeof TOOL_NAMES)[number])) {
        throw new HttpError(403, "Only the six bot tools are allowed. No web or system tools.");
      }
    }
  }
  return payload;
}

async function modelProxy(
  request: IncomingMessage, response: ServerResponse, config: BrokerConfig,
  fetcher: typeof fetch,
): Promise<void> {
  const endpoint = {
    "openai-completions": "/chat/completions",
    "openai-responses": "/responses",
    "anthropic-messages": "/v1/messages",
  }[config.model.api as "openai-completions" | "openai-responses" | "anthropic-messages"];
  const payload = checkModelRequest(await jsonBody(request, 2 * 1024 * 1024), config);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
  if (config.model.api === "anthropic-messages") {
    headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    const beta = request.headers["anthropic-beta"];
    if (typeof beta === "string" && beta.length <= 512 && /^[A-Za-z0-9,._-]+$/.test(beta)) headers["anthropic-beta"] = beta;
  } else if (config.model.provider === "azure") {
    headers["api-key"] = config.apiKey; // Azure v1 API-key auth, not the client's placeholder.
  } else headers.authorization = `Bearer ${config.apiKey}`;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 180_000);
  const disconnect = () => { if (!response.writableEnded) abort.abort(); };
  response.on("close", disconnect);
  try {
    // Not an HTTP CONNECT proxy: destination/path and credentials come only from
    // immutable server code + administrator configuration. Never follow redirects.
    const upstream = await fetcher(`${config.model.baseUrl.replace(/\/$/, "")}${endpoint}`, {
      method: "POST", headers, body: JSON.stringify(payload), redirect: "error", signal: abort.signal,
    });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      throw new HttpError(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
        `Model provider returned HTTP ${upstream.status}. Ask an organizer to check API access or quota.`);
    }
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "text/event-stream",
      "cache-control": "no-store",
    });
    await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), response);
  } finally {
    clearTimeout(timer);
    response.off("close", disconnect);
  }
}

export function createBrokerServer(config: BrokerConfig, bots: BotService, fetcher: typeof fetch = fetch) {
  const proxyPath = {
    "openai-completions": "/llm/v1/chat/completions",
    "openai-responses": "/llm/v1/responses",
    "anthropic-messages": "/llm/v1/messages",
  }[config.model.api as "openai-completions" | "openai-responses" | "anthropic-messages"];
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
      if (request.method === "GET" && request.url === "/config") return send(response, 200, config.publicConfig);
      if (request.method === "GET" && request.url === "/bot") return send(response, 200, await bots.read());
      if (request.method === "POST" && (request.url === proxyPath ||
          (config.model.api === "anthropic-messages" && request.url === `${proxyPath}?beta=true`))) {
        return await modelProxy(request, response, config, fetcher);
      }
      if (request.method !== "POST" || !["/bot/save", "/bot/verify", "/bot/submit"].includes(request.url || "")) {
        throw new HttpError(404, "No such operation.");
      }
      const body = await jsonBody(request);
      if (request.url === "/bot/save") {
        const args = exactObject(body, ["code", "expected_sha256"]);
        return send(response, 200, await bots.save(args.code, args.expected_sha256));
      }
      exactObject(body, []);
      if (request.url === "/bot/verify") return send(response, 200, await bots.verify());
      return send(response, 200, await bots.submit());
    } catch (error) {
      if (response.headersSent) return response.destroy();
      send(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : "Operation failed safely. Draft kept; ask an organizer.",
      });
    }
  });
  // Never tunnel arbitrary traffic or expose a WebSocket/CONNECT escape hatch.
  server.on("connect", (_request, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.requestTimeout = 180_000;
  return server;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const state = "/state";
  const repository = new BotRepository(config, state, createGitRunner(config, state));
  await repository.initialize(await readFile("/opt/smash/templates/bot.py", "utf8"));
  const bots = new BotService(state, repository, new VerificationQueue("/jobs"));
  const server = createBrokerServer(config, bots);
  server.listen(8080, "0.0.0.0", () => console.log(`Ready for ${config.team}. Credentials remain in the broker.`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Configuration and our Git wrapper errors are intentionally secret-free.
    console.error(error instanceof Error ? error.message : "Broker startup failed. Check team configuration, volume permissions, and repository access.");
    process.exitCode = 1;
  });
}
