import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, truncateHead, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { DOC_TOPICS, type BotSnapshot, type DocTopic, type PublicConfig } from "./shared.js";

export class BrokerClient {
  constructor(private baseUrl = "http://broker:8080") {}

  async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error || `Bot service returned HTTP ${response.status}.`);
    return result;
  }

  config(): Promise<PublicConfig> { return this.request("/config"); }
}

export class LocalDocs {
  constructor(private directory: string) {}

  async read(topic: DocTopic, offset = 1, limit = 200): Promise<string> {
    if (!DOC_TOPICS.includes(topic) || !Number.isInteger(offset) || offset < 1 ||
        !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid documentation topic or line range.");
    const lines = (await readFile(join(this.directory, `${topic}.md`), "utf8")).split("\n");
    const selected = lines.slice(offset - 1, offset - 1 + limit).map((line, index) => `${offset + index}: ${line}`).join("\n");
    return `${topic}.md (${lines.length} lines; read another range to continue)\n${selected}`;
  }

  async search(query: string): Promise<string> {
    if (typeof query !== "string" || !query.trim() || query.length > 100) throw new Error("Use a literal search phrase of 1–100 characters.");
    const matches: string[] = [];
    for (const topic of DOC_TOPICS) {
      const lines = (await readFile(join(this.directory, `${topic}.md`), "utf8")).split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          matches.push(`${topic}:${index + 1}: ${line.slice(0, 400)}`);
          if (matches.length === 40) return `${matches.join("\n")}\n[First 40 matches; narrow the phrase or read a topic.]`;
        }
      }
    }
    return matches.join("\n") || "No matches in the offline libmelee documentation.";
  }
}

function textResult(text: string) {
  const truncated = truncateHead(text, { maxBytes: 48 * 1024, maxLines: 2000 });
  return {
    content: [{ type: "text" as const, text: truncated.content + (truncated.truncated ? "\n[Output truncated; narrow the search/read range.]" : "") }],
    details: undefined,
  };
}

const empty = Type.Object({}, { additionalProperties: false });

export function botTools(client: BrokerClient, docs: LocalDocs): ToolDefinition[] {
  return [
    defineTool({
      name: "read_bot", label: "Read bot", executionMode: "sequential",
      description: "Read the team's only editable file, bot.py, with its SHA-256 revision. Read all its lines before every save. Defaults to the first 500 lines; use next_offset to continue. No filesystem paths are accepted.",
      parameters: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      }, { additionalProperties: false }),
      async execute(_id, args, signal) {
        const bot = await client.request<BotSnapshot>("/bot", undefined, signal);
        const lines = bot.code.split("\n");
        const offset = args.offset ?? 1;
        const end = Math.min(lines.length, offset - 1 + (args.limit ?? 500));
        const next = end < lines.length ? end + 1 : "end";
        return textResult(`bot.py — lines ${offset}–${end} of ${lines.length}\nsha256: ${bot.sha256}\nnext_offset: ${next}\n\n${lines.slice(offset - 1, end).join("\n")}`);
      },
    }),
    defineTool({
      name: "read_docs", label: "Read libmelee documentation",
      description: "Read an offline libmelee Markdown topic. Start with README. Line numbers are 1-based; at most 200 lines/48 KiB per call. No URLs or arbitrary paths.",
      parameters: Type.Object({
        topic: StringEnum([...DOC_TOPICS]),
        offset: Type.Optional(Type.Integer({ minimum: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      }, { additionalProperties: false }),
      async execute(_id, args) { return textResult(await docs.read(args.topic, args.offset, args.limit)); },
    }),
    defineTool({
      name: "search_docs", label: "Search libmelee documentation",
      description: "Search the bundled libmelee documentation for a literal phrase (case-insensitive). Returns at most 40 matches, not a web search or regex/shell command.",
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }),
      async execute(_id, args) { return textResult(await docs.search(args.query)); },
    }),
    defineTool({
      name: "save_bot", label: "Save bot", executionMode: "sequential",
      description: "Replace only bot.py with complete Python source (at most 32 KiB / 2000 lines). Supply the SHA-256 returned by read_bot to avoid overwriting concurrent changes. This saves a draft; it does not publish.",
      parameters: Type.Object({
        code: Type.String({ minLength: 1, maxLength: 32 * 1024 }),
        expected_sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
      }, { additionalProperties: false }),
      async execute(_id, args, signal) { return textResult(JSON.stringify(await client.request("/bot/save", args, signal))); },
    }),
    defineTool({
      name: "verify_bot", label: "Check bot", executionMode: "sequential",
      description: "Check the current bot's syntax, offline-code policy, Bot interface, selectable character, and simulated frame/controller inputs using real libmelee in a separate network-disabled sandbox. No commands or arguments.",
      parameters: empty,
      async execute(_id, _args, signal) { return textResult(JSON.stringify(await client.request("/bot/verify", {}, signal))); },
    }),
    defineTool({
      name: "submit_bot", label: "Publish bot", executionMode: "sequential",
      description: "Verify the exact current bot again, commit a change to bot.py only, and push to this team's fixed repository/branch. No paths, URLs, branches, commit messages, or Git commands are accepted. Return the published commit hash; never claim success on an error.",
      parameters: empty,
      async execute(_id, _args, signal) { return textResult(JSON.stringify(await client.request("/bot/submit", {}, signal))); },
    }),
  ];
}
