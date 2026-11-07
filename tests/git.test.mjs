import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { BotRepository } from "../dist/git.js";

const execute = promisify(execFile);
const starter = await readFile(new URL("../templates/bot.py", import.meta.url), "utf8");
const changed = starter.replace("Character.FOX", "Character.FALCO") + "\n# 🦊 Unicode must survive byte-for-byte.\n";

async function fixture(t, { seed = true, symlinkBot = false, directoryBot = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "smash-git-test-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const remote = join(root, "remote.git");
  const state = join(root, "state");
  const work = join(root, "work");
  await mkdir(state);
  const calls = [];
  const run = async (args, input) => {
    calls.push(args);
    const { stdout } = await execute("git", [
      "-c", `core.hooksPath=${join(root, "no-hooks")}`,
      "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false",
      // Test-only dependency injection: local bare repos, never an option exposed
      // by loadConfig(), the production Git wrapper, or the kid-facing tools.
      "-c", "protocol.file.allow=always", ...args,
    ], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test Team", GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test Team", GIT_COMMITTER_EMAIL: "test@example.invalid" },
      encoding: "utf8", maxBuffer: 1024 * 1024,
    }).catch((error) => { throw error; });
    return stdout;
  };
  // execFile cannot receive stdin through its promise options. Use spawn for the
  // commands that hash blobs/build trees, matching production's argv-only API.
  const { spawn } = await import("node:child_process");
  const runWithInput = (args, input) => input === undefined ? run(args) : new Promise((resolve, reject) => {
    calls.push(args);
    const child = spawn("git", ["-c", `core.hooksPath=${join(root, "no-hooks")}`, "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test Team", GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test Team", GIT_COMMITTER_EMAIL: "test@example.invalid" },
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(input);
  });
  await run(["init", "--bare", "--initial-branch=main", remote]);
  if (seed) {
    await run(["init", "--initial-branch=main", work]);
    await mkdir(join(work, ".pi/extensions"), { recursive: true });
    await writeFile(join(work, "README.md"), "This must never change.\n");
    await writeFile(join(work, "odd\nname.txt"), "Keep this file too.\n");
    await writeFile(join(work, ".pi/extensions/evil.ts"), 'throw new Error("Must never load a remote extension");');
    await writeFile(join(work, ".gitattributes"), "bot.py filter=never-execute\n");
    if (symlinkBot) await symlink("/etc/passwd", join(work, "bot.py"));
    else if (directoryBot) { await mkdir(join(work, "bot.py")); await writeFile(join(work, "bot.py/a"), "x"); }
    else await writeFile(join(work, "bot.py"), starter);
    await run(["-C", work, "add", "."]);
    await run(["-C", work, "commit", "-m", "Initial team repo"]);
    await run(["-C", work, "remote", "add", "origin", remote]);
    await run(["-C", work, "push", "origin", "main"]);
  }
  const config = { team: "team_a", repository: remote, branch: "main" };
  const bare = join(state, "repository.git");
  const repo = new BotRepository(config, state, runWithInput);
  const remoteGit = (args) => run([`--git-dir=${remote}`, ...args]);
  const localGit = (args) => run([`--git-dir=${bare}`, ...args]);
  return { root, remote, work, state, config, calls, run: runWithInput, repo, remoteGit, localGit };
}

test("fetch reads only bot.py; publishing changes exactly one tracked path and preserves the rest of the tree", async (t) => {
  const f = await fixture(t);
  const original = (await f.remoteGit(["rev-parse", "main"])).trim();
  await f.repo.initialize(starter);
  assert.equal(await readFile(join(f.state, "bot.py"), "utf8"), starter);
  const publishingCalls = f.calls.length;
  const published = await f.repo.publish(changed);
  assert.match(published.commit, /^[a-f0-9]{40}$/);
  assert.equal(await f.remoteGit(["show", "main:bot.py"]), changed);
  assert.equal(await f.remoteGit(["diff", "--name-only", original, published.commit]), "bot.py\n");
  assert.equal(await f.remoteGit(["show", "main:README.md"]), "This must never change.\n");
  assert.equal(await f.remoteGit(["show", "main:odd\nname.txt"]), "Keep this file too.\n");
  assert.equal(await f.remoteGit(["show", "main:.pi/extensions/evil.ts"]), 'throw new Error("Must never load a remote extension");');
  const again = await f.repo.publish(changed);
  assert.equal(again.commit, published.commit); // no empty commits
  assert.ok(!f.calls.slice(publishingCalls).some((args) => args.includes("checkout") || args.includes("add") || args.includes("--force")));
  const pushes = f.calls.filter((args) => args.includes("--porcelain"));
  assert.deepEqual(pushes[0].slice(-2), ["origin", `${published.commit}:refs/heads/main`]);
});

test("a truly empty repository gets a first commit containing bot.py only", async (t) => {
  const f = await fixture(t, { seed: false });
  await f.repo.initialize(starter);
  const published = await f.repo.publish(starter);
  assert.equal(await f.remoteGit(["ls-tree", "--name-only", published.commit]), "bot.py\n");
  assert.equal(await f.remoteGit(["show", "main:bot.py"]), starter);
});

test("failed push preserves the exact commit and retries it after restart without making a second commit", async (t) => {
  const f = await fixture(t);
  let fail = true;
  const runner = (args, input) => {
    if (args.includes("push") && fail) { fail = false; throw new Error("network down"); }
    return f.run(args, input);
  };
  const first = new BotRepository(f.config, f.state, runner);
  await first.initialize(starter);
  await assert.rejects(first.publish(changed), /draft are kept/);
  const pendingCommit = (await f.localGit(["rev-parse", "main"])).trim();
  assert.equal(await f.localGit(["show", "main:bot.py"]), changed);
  const restarted = new BotRepository(f.config, f.state, f.run);
  await restarted.initialize(starter);
  const published = await restarted.publish(changed);
  assert.equal(published.commit, pendingCommit);
  assert.equal((await f.remoteGit(["rev-parse", "main"])).trim(), pendingCommit);
});

test("a successful push with a lost acknowledgment is recovered idempotently", async (t) => {
  const f = await fixture(t);
  const runner = async (args, input) => {
    const result = await f.run(args, input);
    if (args.includes("push")) throw new Error("lost acknowledgment");
    return result;
  };
  const first = new BotRepository(f.config, f.state, runner);
  await first.initialize(starter);
  await assert.rejects(first.publish(changed), /Push failed/);
  const pendingCommit = (await f.localGit(["rev-parse", "main"])).trim();
  const restarted = new BotRepository(f.config, f.state, f.run);
  await restarted.initialize(starter);
  assert.equal((await restarted.publish(changed)).commit, pendingCommit);
});

test("remote changes are rejected, never merged or force-pushed away", async (t) => {
  const f = await fixture(t);
  await f.repo.initialize(starter);
  await f.run(["-C", f.work, "config", "user.name", "Administrator"]);
  await writeFile(join(f.work, "README.md"), "Administrator changed this.\n");
  await f.run(["-C", f.work, "add", "README.md"]);
  await f.run(["-C", f.work, "commit", "-m", "Admin change"]);
  await f.run(["-C", f.work, "push", "origin", "main"]);
  await assert.rejects(f.repo.publish(changed), /remote changed/);
  assert.equal(await f.remoteGit(["show", "main:README.md"]), "Administrator changed this.\n");
  assert.equal(await f.remoteGit(["show", "main:bot.py"]), starter);
});

test("remote symlink/directory bot.py and a reused other-team volume fail closed", async (t) => {
  for (const option of [{ symlinkBot: true }, { directoryBot: true }]) {
    const f = await fixture(t, option);
    await assert.rejects(f.repo.initialize(starter), /regular file/);
  }
  const f = await fixture(t);
  await f.repo.initialize(starter);
  const other = new BotRepository({ ...f.config, team: "team_b" }, f.state, f.run);
  await assert.rejects(other.initialize(starter), /different team/);
});

test("a saved draft survives a fresh UI/broker process", async (t) => {
  const f = await fixture(t);
  await f.repo.initialize(starter);
  await writeFile(join(f.state, "bot.py"), changed);
  const restarted = new BotRepository(f.config, f.state, f.run);
  await restarted.initialize(starter);
  assert.equal(await readFile(join(f.state, "bot.py"), "utf8"), changed);
});
