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

// A fixed SDK resource loader, not the general-purpose Pi CLI. No discovered
// extensions/MCP, @file expansion, !shell, external editor, or slash commands.
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

// Model output is data, not terminal control sequences (OSC52, etc.).
export function safeText(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

export const WELCOME = "Tell me what your bot should do, then press Enter.";
export const NEED_HELP = "I couldn't finish your bot yet. Please ask the organizer to help.";

export function sendTextPrompt(session: Pick<AgentSession, "prompt">, text: string): Promise<void> {
  // Every submission is a literal prompt, even when it starts with /, !, or @.
  // Verification/submission belong to the agent's tools, never to UI commands.
  return session.prompt(text, { expandPromptTemplates: false });
}

const LABELS: Record<string, string> = {
  read_bot: "Looking at your bot", read_docs: "Thinking about your idea",
  search_docs: "Thinking about your idea", save_bot: "Making your changes",
  verify_bot: "Checking your bot", submit_bot: "Sending your bot",
};

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Open this with the team launcher in a terminal (Docker needs -it).");
  }
  const client = new BrokerClient();
  const config = await client.config();
  const docs = new LocalDocs(join(ROOT, "docs/libmelee"));
  const instructions = await readFile(join(ROOT, "AGENTS.md"), "utf8");
  const session = await createTeamSession(config, client, docs, instructions);

  const tui = new TuiMainScreen(new ProcessTerminal(), false, "/tmp");
  const transcript = new Container();
  const status = new Text("Ready — tell me your idea!", 1, 0);
  const identity = (text: string) => text;
  const editor = new Editor(tui, {
    borderColor: identity,
    selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity },
  }, { paddingX: 1 });
  tui.addChild(new Text(`Smash Bots · ${config.team.toUpperCase().replace("_", " ")}\n${WELCOME}`, 1, 1));
  tui.addChild(transcript);
  tui.addChild(status);
  tui.addChild(editor);
  tui.setFocus(editor);
  const pending: string[] = [];
  let active = false;
  let closing = false;
  let currentAssistant: Text | undefined;
  let showedError = false;

  function add(text: string): Text {
    const component = new Text(safeText(text), 1, 1);
    transcript.addChild(component);
    while (transcript.children.length > 200) transcript.removeChild(transcript.children[0]!);
    tui.requestRender();
    return component;
  }

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "assistant") currentAssistant = undefined;
    if (event.type === "message_update" && event.message.role === "assistant") {
      const text = event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      if (text) {
        currentAssistant ||= add("Pi:");
        currentAssistant.setText(`Pi:\n${safeText(text)}`);
        tui.requestRender();
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant" && event.message.errorMessage && !showedError) {
      showedError = true;
      add(NEED_HELP);
    }
    if (event.type === "tool_execution_start") {
      status.setText(`${LABELS[event.toolName] || "Working on your idea"}…`);
      tui.requestRender();
    }
    if (event.type === "tool_execution_end" && event.isError) {
      // The model sees the full tool error so it can repair/retry; children do not.
      status.setText("Working on your bot…");
      tui.requestRender();
    }
    // Never display raw tool results: Python diagnostics, source, JSON, and Git
    // commit hashes are for the agent/organizer, not the child's transcript.
  });

  async function quit(): Promise<void> {
    if (closing) return;
    closing = true;
    pending.length = 0;
    await session.abort();
    unsubscribe();
    session.dispose();
    tui.stop();
    console.log("Your saved changes are kept. See you next round!");
    process.exit(0);
  }

  async function drain(): Promise<void> {
    if (active || closing) return;
    active = true;
    try {
      while (pending.length && !closing) {
        const text = pending.shift()!;
        showedError = false;
        status.setText("Working on your idea…");
        tui.requestRender();
        try { await sendTextPrompt(session, text); }
        catch { if (!showedError && !closing) add(NEED_HELP); }
      }
    } finally {
      active = false;
      if (!closing) {
        status.setText("Ready — what should your bot do next?");
        tui.requestRender();
      }
    }
  }

  editor.onSubmit = (text) => {
    text = text.trim();
    if (!text || closing) return;
    if (text.length > 8000) { add("Try telling me your idea in a shorter sentence."); return; }
    if (pending.length >= 10) { add("I have lots of ideas to finish. Please wait a moment."); return; }
    editor.setText("");
    editor.addToHistory(text);
    add(`You: ${text}`);
    pending.push(text);
    void drain(); // Enter also works while busy; requests run safely one at a time.
  };

  // Organizer-only terminal controls; no special commands are shown or required.
  tui.addInputListener((data) => {
    if (matchesKey(data, "escape") && active) {
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
