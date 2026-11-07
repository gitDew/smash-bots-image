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
const broken = changed.replace("1.0 if dx > 0 else 0.0, 0.5", "99.0, 0.5");
await writeFile("/state/bot.py", starter, { mode: 0o600 });
let published;
let submissions = 0;
const bots = new BotService("/state", {
  async publish(code) {
    if (code !== changed) throw new Error("The wrong code reached publication.");
    published = { commit: createHash("sha1").update(code).digest("hex"), sha256: sha256(code), submissions: ++submissions };
    await writeFile("/state/test-published.json", JSON.stringify(published), { mode: 0o600 });
    return { commit: published.commit, message: "Test publisher accepted the verified bot." };
  },
}, new VerificationQueue("/jobs"));
let turn = 0;
const fetcher = async (_url, options) => {
  const step = turn++;
  const payload = JSON.parse(options.body);
  if (step === 3 && !options.body.includes("Analog input")) throw new Error("The model did not receive verification diagnostics for automatic repair.");
  const save = { code: step === 1 ? broken : changed, expected_sha256: (await bots.read()).sha256 };
  const operations = [["read_bot", {}], ["save_bot", save], ["verify_bot", {}], ["read_bot", {}], ["save_bot", save], ["verify_bot", {}], ["submit_bot", {}]];
  const operation = operations[step];
  const userContent = payload.messages.filter((message) => message.role === "user").at(-1)?.content;
  const userText = typeof userContent === "string" ? userContent : userContent?.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const reply = step === operations.length ? "Your Falco bot is ready!" : userText === "/submit"
    ? "Slash text is a regular prompt." : "Your bot chases nearby opponents.";
  const delta = operation ? {
    role: "assistant", tool_calls: [{ index: 0, id: `call_${step}`, type: "function", function: { name: operation[0], arguments: JSON.stringify(operation[1]) } }],
  } : { role: "assistant", content: reply };
  const data = (choices) => ({ id: `test_${step}`, object: "chat.completion.chunk", model: config.model.id, choices });
  const body = [
    `data: ${JSON.stringify(data([{ index: 0, delta, finish_reason: null }]))}\n\n`,
    `data: ${JSON.stringify(data([{ index: 0, delta: {}, finish_reason: operation ? "tool_calls" : "stop" }]))}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
};
createBrokerServer(config, bots, fetcher).listen(8080, "0.0.0.0", () => console.log("Test broker ready; model/Git are fake, Python verification is real."));
