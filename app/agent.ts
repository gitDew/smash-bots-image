import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import {
  createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager,
  SettingsManager, type AgentSession, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { Container, Editor, matchesKey, ProcessTerminal, Text, TuiMainScreen } from "@earendil-works/pi-tui";
import { botTools, BrokerClient, LocalDocs } from "./tools.js";
import { TOOL_NAMES, type PublicConfig } from "./shared.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// A fixed SDK resource loader, not DefaultResourceLoader/InteractiveMode. In
// particular: no discovered extensions/MCP, project settings, @file expansion,
// !shell, external editor, /login, /share, /export, /reload, or model picker.
export function fixedResources(instructions: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => instructions,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export async function createTeamSession(
  config: PublicConfig, client: BrokerClient, docs: LocalDocs, instructions: string,
): Promise<AgentSession> {
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStore: new InMemoryModelsStore(),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider(config.model.provider, {
    api: config.model.api,
    baseUrl: config.model.baseUrl,
    apiKey: "event-proxy-placeholder", // NOT a credential; replaced by the broker.
    models: [config.model],
  });
  const model = modelRuntime.getModel(config.model.provider, config.model.id);
  if (!model) throw new Error("The administrator's model configuration could not be loaded.");
  const { session } = await createAgentSession({
    cwd: ROOT,
    agentDir: "/tmp/pi",
    model, modelRuntime,
    thinkingLevel: config.thinking,
    tools: [...TOOL_NAMES],
    noTools: "builtin",
    customTools: botTools(client, docs),
    resourceLoader: fixedResources(instructions),
    sessionManager: SessionManager.inMemory(ROOT),
    settingsManager: SettingsManager.inMemory({
      defaultTools: [], defaultProjectTrust: "never", hideThinkingBlock: true,
      enableInstallTelemetry: false, enableAnalytics: false,
      transport: "sse", httpIdleTimeoutMs: 180_000,
      compaction: { enabled: true, reserveTokens: 8192, keepRecentTokens: 16000 },
      retry: { enabled: true, maxRetries: 2, provider: { maxRetries: 0, timeoutMs: 180_000 } },
    }),
  });
  if (session.getActiveToolNames().sort().join(",") !== [...TOOL_NAMES].sort().join(",")) {
    session.dispose();
    throw new Error("Unexpected tool configuration; refusing to start.");
  }
  return session;
}

// Model/code output is data, not terminal escape sequences (OSC52, etc.).
export function safeText(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

export function operationText(value: unknown): string {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    const result = value as { message: string; ok?: boolean; commit?: string };
    const commit = typeof result.commit === "string" ? `\nPublished version: ${result.commit.slice(0, 12)}` : "";
    return `${result.ok === false ? "Needs attention: " : ""}${result.message}${commit}`;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

export const HELP = "Describe your bot and press Enter. Shift+Enter (or Ctrl+J) adds a line.\n/verify checks it • /submit publishes it • /new clears the chat • /quit exits\nEscape stops Pi. Drafts survive restarts; chat is temporary.";

export function commandFor(text: string): "help" | "verify" | "submit" | "new" | "quit" | "unknown" | undefined {
  if (!text.startsWith("/")) return undefined;
  const commands = new Map([
    ["/help", "help"], ["/verify", "verify"], ["/submit", "submit"], ["/new", "new"], ["/quit", "quit"],
  ] as const);
  return commands.get(text as Parameters<typeof commands.get>[0]) || "unknown";
}

const LABELS: Record<string, string> = {
  read_bot: "Reading your bot", read_docs: "Reading libmelee documentation",
  search_docs: "Looking up libmelee", save_bot: "Saving your changes",
  verify_bot: "Checking your bot", submit_bot: "Publishing your bot",
};

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Open this with the team launcher in a terminal (Docker needs -it).");
  }
  const client = new BrokerClient();
  const config = await client.config();
  const docs = new LocalDocs(join(ROOT, "docs/libmelee"));
  const instructions = await readFile(join(ROOT, "AGENTS.md"), "utf8");
  let session = await createTeamSession(config, client, docs, instructions);

  const tui = new TuiMainScreen(new ProcessTerminal(), false, "/tmp");
  const transcript = new Container();
  const status = new Text("Ready — tell Pi what your bot should do!", 1, 0);
  const identity = (text: string) => text;
  const editor = new Editor(tui, {
    borderColor: identity,
    selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity },
  }, { paddingX: 1 });
  tui.addChild(new Text(`Smash Bots · ${config.team.toUpperCase().replace("_", " ")} · powered by Pi\n${HELP}`, 1, 1));
  tui.addChild(transcript);
  tui.addChild(status);
  tui.addChild(editor);
  tui.setFocus(editor);
  let active = false;
  let directAbort: AbortController | undefined;
  let currentAssistant: Text | undefined;
  let closing = false;

  function add(text: string): Text {
    const component = new Text(safeText(text), 1, 1);
    transcript.addChild(component);
    // Keep in-process UI memory bounded; regular mode has native terminal scrollback.
    while (transcript.children.length > 200) transcript.removeChild(transcript.children[0]!);
    tui.requestRender();
    return component;
  }

  function subscribe(): () => void {
    return session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant") currentAssistant = undefined;
      if (event.type === "message_update" && event.message.role === "assistant") {
        const text = event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        if (text) {
          currentAssistant ||= add("Pi:");
          currentAssistant.setText(`Pi:\n${safeText(text)}`);
          tui.requestRender();
        }
      }
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.errorMessage) {
        add(`Pi could not finish: ${event.message.errorMessage}`);
      }
      if (event.type === "tool_execution_start") {
        status.setText(`${LABELS[event.toolName] || "Working"}…`);
        tui.requestRender();
      }
      if (event.type === "tool_execution_end") {
        if (event.isError || event.toolName === "verify_bot" || event.toolName === "submit_bot") {
          const result = event.result as { content?: { type: string; text?: string }[] };
          const text = result.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n");
          if (text) {
            let display = text;
            if (!event.isError) {
              try { display = operationText(JSON.parse(text)); } catch { /* ordinary text result */ }
            }
            add(`${event.isError ? "Needs attention: " : ""}${display}`);
          }
        }
      }
    });
  }
  let unsubscribe = subscribe();

  async function quit(): Promise<void> {
    if (closing) return;
    closing = true;
    directAbort?.abort();
    await session.abort();
    unsubscribe();
    session.dispose();
    tui.stop();
    console.log("Your draft is kept. See you next round!");
    process.exit(0);
  }

  async function submit(text: string): Promise<void> {
    text = text.trim();
    if (!text || active || closing) return;
    if (text.length > 8000) {
      status.setText("Please keep your prompt under 8000 characters.");
      tui.requestRender();
      return;
    }
    const command = commandFor(text);
    if (command === "quit") return quit();
    editor.setText("");
    editor.addToHistory(text);
    if (command === "help" || command === "unknown") { add(HELP); return; }
    active = true;
    editor.disableSubmit = true;
    status.setText("Pi is working… (Escape to stop)");
    add(`You: ${text}`);
    try {
      if (command === "new") {
        unsubscribe();
        session.dispose();
        session = await createTeamSession(config, client, docs, instructions);
        unsubscribe = subscribe();
        transcript.clear();
        currentAssistant = undefined;
        add("New chat. Your bot draft has not changed.");
      } else if (command === "verify" || command === "submit") {
        directAbort = new AbortController();
        const result = await client.request(`/bot/${command}`, {}, directAbort.signal);
        add(operationText(result));
      } else {
        // All other input is literal prompt text, including !commands and @paths.
        await session.prompt(text, { expandPromptTemplates: false });
      }
    } catch (error) {
      add(`Could not finish: ${error instanceof Error ? error.message : "Ask an event organizer."}`);
    } finally {
      active = false;
      directAbort = undefined;
      editor.disableSubmit = false;
      status.setText("Ready — what should your bot do next?");
      tui.requestRender();
    }
  }

  editor.onSubmit = (text) => { void submit(text); };
  tui.addInputListener((data) => {
    if (matchesKey(data, "escape") && active) {
      directAbort?.abort();
      void session.abort();
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+c") || (matchesKey(data, "ctrl+d") && !editor.getText())) {
      void quit();
      return { consume: true };
    }
    return undefined;
  });
  process.on("SIGTERM", () => { void quit(); });
  process.on("SIGINT", () => { void quit(); });
  tui.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Team UI could not start.");
    process.exitCode = 1;
  });
}
