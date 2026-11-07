import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { atomicWrite, checkCode, HttpError, sha256, type Verification } from "./shared.js";

// The broker never imports or executes bot code. Jobs cross a Docker volume into
// a credential-free, network_mode:none validator, whose child has a different UID.
export class VerificationQueue {
  constructor(private directory: string, private timeoutMs = 30_000) {}

  async verify(code: string): Promise<Verification> {
    checkCode(code);
    const hash = sha256(code);
    const job = join(this.directory, randomUUID());
    await mkdir(job, { mode: 0o770 });
    await chmod(job, 0o770); // The validator parent writes as group 1000, not as this UID.
    await atomicWrite(join(job, "request.json"), JSON.stringify({ code, sha256: hash }), 0o640);
    try {
      const deadline = Date.now() + this.timeoutMs;
      while (Date.now() < deadline) {
        let result: string | undefined;
        try { result = await readFile(join(job, "result.json"), "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (result) {
          if (Buffer.byteLength(result) > 16 * 1024) throw new Error("Invalid validator result size.");
          const parsed = JSON.parse(result) as Verification;
          if (typeof parsed.ok !== "boolean" || parsed.sha256 !== hash ||
              typeof parsed.message !== "string" || parsed.message.length > 4096) {
            throw new Error("Validator result did not match this bot snapshot.");
          }
          return parsed;
        }
        await sleep(100);
      }
      throw new HttpError(503, "Verification timed out. Nothing was published; ask an organizer to check the validator.");
    } finally {
      await rm(job, { recursive: true, force: true });
    }
  }
}
