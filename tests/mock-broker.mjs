// Trusted test-only broker entrypoint: no public model calls or repository pushes.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "/opt/smash/dist/config.js";
import { BotService, createBrokerServer } from "/opt/smash/dist/broker.js";
import { VerificationQueue } from "/opt/smash/dist/verification.js";
import { sha256 } from "/opt/smash/dist/shared.js";

const config = loadConfig({ TEAM_ID: "team_a", TEAM_REPO_URL: "https://github.com/example/test-only.git", GITHUB_TOKEN: "fake", OPENCODE_API_KEY: "fake", LLM_PROVIDER: "opencode-go", LLM_MODEL: "kimi-k2.6" });
const starter = await readFile("/opt/smash/templates/bot.py", "utf8");
const changed = starter.replace("return melee.Character.FOX", "return melee.Character.FALCO");
await writeFile("/state/bot.py", starter, { mode: 0o600 });
let published;
const bots = new BotService("/state", {
  async publish(code) {
    if (code !== changed) throw new Error("The wrong code reached publication.");
    published = { commit: createHash("sha1").update(code).digest("hex"), sha256: sha256(code) };
    await writeFile("/state/test-published.json", JSON.stringify(published), { mode: 0o600 });
    return { commit: published.commit, message: "Test publisher accepted the verified bot." };
  },
}, new VerificationQueue("/jobs"));
let turn = 0;
const fetcher = async () => {
  const step = turn++;
  const save = { code: changed, expected_sha256: (await bots.read()).sha256 };
  const operations = [["read_bot", {}], ["save_bot", save], ["verify_bot", {}], ["submit_bot", {}]];
  const operation = operations[step];
  const delta = operation ? {
    role: "assistant", tool_calls: [{ index: 0, id: `call_${step}`, type: "function", function: { name: operation[0], arguments: JSON.stringify(operation[1]) } }],
  } : { role: "assistant", content: "Your Falco bot has been published by the test publisher." };
  const data = (choices) => ({ id: `test_${step}`, object: "chat.completion.chunk", model: config.model.id, choices });
  const body = [
    `data: ${JSON.stringify(data([{ index: 0, delta, finish_reason: null }]))}\n\n`,
    `data: ${JSON.stringify(data([{ index: 0, delta: {}, finish_reason: operation ? "tool_calls" : "stop" }]))}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
};
createBrokerServer(config, bots, fetcher).listen(8080, "0.0.0.0", () => console.log("Test broker ready; model/Git are fake, Python verification is real."));
