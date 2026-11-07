import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv, placeholder } from "./env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function initEvent(root = ROOT, destination = resolve(root, ".env.event")) {
  let text = await readFile(resolve(root, ".env.event.example"), "utf8");
  let reused = false;
  try {
    const existing = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
    const provider = parseEnv(text).LLM_PROVIDER;
    const keyName = {
      azure: "AZURE_OPENAI_API_KEY", "opencode-go": "OPENCODE_API_KEY", opencode: "OPENCODE_API_KEY",
      openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY",
    }[provider];
    if (keyName && !placeholder(existing[keyName])) {
      // Reuse only the selected provider's key; never silently switch providers.
      text = text.replace(new RegExp(`^${keyName}=.*$`, "m"), () => `${keyName}=${existing[keyName]}`);
      reused = true;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Could not read the existing .env safely; it has not been modified.");
  }
  await writeFile(destination, text, { mode: 0o600, flag: "wx" }); // Never overwrite an existing master config.
  return { path: destination, reusedModelKey: reused };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initEvent().then((result) => {
    console.log(`Created ${result.path} with private permissions.${result.reusedModelKey ? " Existing model key reused without displaying it." : " Fill in the model key too."}`);
    console.log("Enter the four team GitHub tokens locally. Do not paste them into chat.");
  }).catch((error) => {
    console.error(error.code === "EEXIST" ? ".env.event already exists; preserved without changes." : "Could not initialize the private configuration; existing files were preserved.");
    process.exitCode = 1;
  });
}
