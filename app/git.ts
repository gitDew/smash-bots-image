import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite, checkCode, HttpError, sha256 } from "./shared.js";
import type { BrokerConfig } from "./config.js";

export type GitRun = (args: string[], input?: string) => Promise<string>;
const OID = /^[0-9a-f]{40,64}$/;

export function createGitRunner(config: BrokerConfig, state: string): GitRun {
  return (args, input) => new Promise((resolve, reject) => {
    // No shell interpolation, inherited Git config, repository hooks, credential storage,
    // external protocols, redirects, signing commands, or filesystem monitor programs.
    const child = spawn("git", [
      "-c", "core.hooksPath=/opt/smash/no-hooks",
      "-c", "core.fsmonitor=false",
      "-c", "commit.gpgsign=false",
      "-c", "credential.helper=",
      "-c", "http.followRedirects=false",
      "-c", "protocol.allow=never",
      "-c", "protocol.https.allow=always",
      ...args,
    ], {
      cwd: state,
      env: {
        PATH: process.env.PATH,
        HOME: "/tmp/git-home",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/opt/smash/git-askpass.sh",
        GITHUB_TOKEN: config.githubToken,
        GIT_AUTHOR_NAME: `Smash Bots ${config.team}`,
        GIT_AUTHOR_EMAIL: `${config.team}@kids-event.invalid`,
        GIT_COMMITTER_NAME: `Smash Bots ${config.team}`,
        GIT_COMMITTER_EMAIL: `${config.team}@kids-event.invalid`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) child.kill("SIGKILL");
      else output.push(chunk);
    });
    // Drain stderr but never return it to the agent (it can contain credential errors).
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new HttpError(502, "Git could not start. Ask an event organizer."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || bytes > 1024 * 1024) {
        reject(new HttpError(502, "Git operation failed. Check repository access, connectivity, and token permissions."));
      } else {
        try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(output))); }
        catch { reject(new HttpError(502, "Git data must be valid UTF-8. Ask an organizer to check the repository.")); }
      }
    });
    child.stdin.end(input);
  });
}

function oid(value: string): string {
  const result = value.trim();
  if (!OID.test(result)) throw new Error("Git returned an invalid object ID.");
  return result;
}

export class BotRepository {
  private bare: string;
  private localRef: string;
  private remoteRef = "refs/remotes/origin/event";
  private initialized = false;

  constructor(private config: BrokerConfig, private state: string, private run: GitRun) {
    this.bare = join(state, "repository.git");
    this.localRef = `refs/heads/${config.branch}`;
  }

  private git(args: string[], input?: string): Promise<string> {
    return this.run([`--git-dir=${this.bare}`, ...args], input);
  }

  private async ref(name: string): Promise<string | undefined> {
    const refs = await this.git(["for-each-ref", "--format=%(objectname)", name]);
    return refs.trim() ? oid(refs) : undefined;
  }

  private async remoteHead(): Promise<string | undefined> {
    const refs = await this.git(["ls-remote", "--heads", "origin"]);
    const line = refs.split("\n").find((row) => row.split("\t")[1] === this.localRef);
    if (line) return oid(line.split("\t")[0]!);
    if (refs.trim()) throw new HttpError(409, `The remote has no ${this.config.branch} branch. Ask an organizer.`);
    return undefined; // A completely empty repository is supported.
  }

  async initialize(starter: string): Promise<void> {
    await mkdir(this.state, { recursive: true });
    const identity = JSON.stringify({ team: this.config.team, repository: this.config.repository, branch: this.config.branch });
    let existing: string | undefined;
    try { existing = await readFile(join(this.state, "identity.json"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (existing && existing !== identity) {
      throw new Error("This volume belongs to a different team/repository/branch. Use a separate Compose project.");
    }
    if (!existing) await atomicWrite(join(this.state, "identity.json"), identity);

    // Idempotent after an interrupted first startup; no checkout ever occurs.
    await this.run(["init", "--bare", this.bare]);
    await this.git(["config", "remote.origin.url", this.config.repository]);
    if (!await this.ref(this.localRef)) {
      const head = await this.remoteHead();
      if (head) {
        await this.git(["fetch", "--no-tags", "--depth=1", "origin", `${this.localRef}:${this.remoteRef}`]);
        const fetched = await this.ref(this.remoteRef);
        if (!fetched) throw new Error("Fetched branch was missing.");
        await this.git(["update-ref", this.localRef, fetched]);
      }
    }
    // Preserve drafts and unpushed commits across restarts. Remote changes are never
    // silently merged or force-pushed over; an organizer must resolve a conflict.
    let draft: string | undefined;
    try { draft = await readFile(join(this.state, "bot.py"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (draft === undefined) {
      const head = await this.ref(this.localRef);
      let code = starter;
      if (head) {
        const entries = await this.git(["ls-tree", "-z", head, "--", "bot.py"]);
        if (entries) {
          if (!/^100(?:644|755) blob [0-9a-f]+\tbot\.py\0$/.test(entries)) {
            throw new Error("Remote bot.py must be a regular file, not a symlink or directory.");
          }
          code = await this.git(["show", `${head}:bot.py`]);
        }
      }
      checkCode(code);
      await atomicWrite(join(this.state, "bot.py"), code);
    } else checkCode(draft);
    this.initialized = true;
  }

  async publish(code: string): Promise<{ commit: string; message: string }> {
    if (!this.initialized) throw new Error("Repository is not initialized.");
    checkCode(code);
    const parent = await this.ref(this.localRef);
    const expectedRemote = await this.ref(this.remoteRef);
    const currentRemote = await this.remoteHead();
    // Also recover when a push succeeded but the process died before recording it.
    if (currentRemote !== expectedRemote && currentRemote !== parent) {
      throw new HttpError(409, "The remote changed outside this laptop. Draft kept; ask an organizer to synchronize it.");
    }
    const blob = oid(await this.git(["hash-object", "-w", "--stdin"], code));
    const oldEntries = parent ? await this.git(["ls-tree", "-z", parent]) : "";
    const retained = oldEntries.split("\0").filter((entry) => entry && entry.slice(entry.indexOf("\t") + 1) !== "bot.py");
    // Build a tree containing exactly the old tree plus this one regular file.
    // No index, working-tree files, hooks, submodules, or other paths are staged.
    retained.push(`100644 blob ${blob}\tbot.py`);
    const tree = oid(await this.git(["mktree", "-z"], `${retained.join("\0")}\0`));
    const previousTree = parent ? oid(await this.git(["rev-parse", `${parent}^{tree}`])) : undefined;
    let commit = parent;
    if (tree !== previousTree) {
      commit = oid(await this.git([
        "commit-tree", tree, ...(parent ? ["-p", parent] : []),
      ], `${this.config.team}: update bot ${sha256(code).slice(0, 12)}\n`));
      await this.git(["update-ref", this.localRef, commit, parent || ""]);
    }
    if (!commit) throw new Error("Commit was missing.");
    if (currentRemote !== commit) {
      try {
        await this.git(["push", "--porcelain", "origin", `${commit}:${this.localRef}`]);
      } catch {
        throw new HttpError(502, `Push failed. Commit ${commit} and your draft are kept; submit again to retry. Never force-push.`);
      }
    }
    await this.git(["update-ref", this.remoteRef, commit]);
    return { commit, message: "Bot verified and published." };
  }
}
