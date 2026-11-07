import { createHash, randomUUID } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import type { Api, Model } from "@earendil-works/pi-ai";

export const MAX_BOT_BYTES = 32 * 1024;
export const TOOL_NAMES = [
  "read_bot", "read_docs", "search_docs", "save_bot", "verify_bot", "submit_bot",
] as const;
export const DOC_TOPICS = [
  "README", "index", "overview", "controller", "gamestate", "enums",
  "stages", "framedata", "console", "menuhelper", "logger",
] as const;
export type DocTopic = (typeof DOC_TOPICS)[number];

export interface PublicConfig {
  team: string;
  model: Model<Api>;
  thinking: "off" | "minimal" | "low" | "medium" | "high";
}

export interface BotSnapshot {
  code: string;
  sha256: string;
}

export interface Verification {
  ok: boolean;
  sha256: string;
  message: string;
  checks?: number;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function sha256(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function checkCode(code: unknown): asserts code is string {
  if (typeof code !== "string" || !code.trim() || code.includes("\0") ||
      Buffer.byteLength(code, "utf8") > MAX_BOT_BYTES || code.split("\n").length > 2000) {
    throw new HttpError(400, "Bot code must be nonempty UTF-8 text, without NUL, at most 32 KiB / 2000 lines.");
  }
  // Reject lone surrogates: hash, disk contents, and validator input must agree.
  if (Buffer.from(code, "utf8").toString("utf8") !== code) {
    throw new HttpError(400, "Bot code must be valid UTF-8.");
  }
}

export function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key))) {
    throw new HttpError(400, `Expected exactly: ${keys.join(", ") || "no arguments"}.`);
  }
  return value as Record<string, unknown>;
}

export async function atomicWrite(path: string, content: string, mode = 0o600): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode, flag: "wx" });
  await rename(temporary, path);
}

// Serialize the entire read/validate/commit/push window, not just file writes.
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }
}
