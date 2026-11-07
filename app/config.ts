import { getModel } from "@earendil-works/pi-ai/compat";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { PublicConfig } from "./shared.js";

const PROVIDERS: Record<string, { key: string; hosts: string[] }> = {
  azure: { key: "AZURE_OPENAI_API_KEY", hosts: [] },
  "opencode-go": { key: "OPENCODE_API_KEY", hosts: ["opencode.ai"] },
  opencode: { key: "OPENCODE_API_KEY", hosts: ["opencode.ai"] },
  openai: { key: "OPENAI_API_KEY", hosts: ["api.openai.com"] },
  anthropic: { key: "ANTHROPIC_API_KEY", hosts: ["api.anthropic.com"] },
  openrouter: { key: "OPENROUTER_API_KEY", hosts: ["openrouter.ai"] },
};

export function providerApiKeyName(provider: string): string {
  const key = PROVIDERS[provider]?.key;
  if (typeof key !== "string") throw new Error("Unsupported LLM_PROVIDER.");
  return key;
}

function azureChatModel(env: NodeJS.ProcessEnv, id: string): Model<Api> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) {
    throw new Error("LLM_MODEL must be the exact, simple Azure deployment name.");
  }
  let endpoint: URL;
  try { endpoint = new URL(required(env, "AZURE_OPENAI_BASE_URL")); }
  catch { throw new Error("Set AZURE_OPENAI_BASE_URL to the HTTPS Azure OpenAI v1 endpoint."); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash ||
      !/^[a-z0-9][a-z0-9-]*\.openai\.azure\.com$/.test(endpoint.hostname) ||
      endpoint.pathname.replace(/\/$/, "") !== "/openai/v1") {
    throw new Error("AZURE_OPENAI_BASE_URL must be https://RESOURCE.openai.azure.com/openai/v1 (no credentials, query, or other paths).");
  }
  // This pin predates Azure's non-OpenAI catalog. Use its supported Chat
  // Completions implementation with the deployment's exact ID, not Azure Responses.
  // Keep a conservative context/output budget; Azure pricing is not estimated.
  // Leave vendor-specific reasoning controls to deployment defaults until live-tested.
  return {
    id, name: `${id} (Azure)`, provider: "azure", api: "openai-completions",
    baseUrl: endpoint.href.replace(/\/$/, ""), reasoning: true, input: ["text"],
    contextWindow: 128000, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
      supportsStrictMode: false, maxTokensField: "max_tokens",
    },
  };
}

export interface BrokerConfig {
  team: string;
  repository: string;
  branch: string;
  githubToken: string;
  apiKey: string;
  model: Model<Api>;
  publicConfig: PublicConfig;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value || /[\r\n\0]/.test(value)) throw new Error(`Set ${key} in the administrator's env file.`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): BrokerConfig {
  const team = required(env, "TEAM_ID");
  if (!/^team_[abcd]$/.test(team)) throw new Error("TEAM_ID must be team_a, team_b, team_c, or team_d.");
  if (env.EXPECTED_TEAM_ID && env.EXPECTED_TEAM_ID !== team) {
    throw new Error("The launcher's team does not match TEAM_ID in the env file.");
  }

  const repository = required(env, "TEAM_REPO_URL");
  if (!/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+\.git$/.test(repository) ||
      new URL(repository).pathname.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("TEAM_REPO_URL must be https://github.com/OWNER/REPOSITORY.git (no embedded credentials).");
  }

  // Deliberately restrict branches to simple, administrator-selected names.
  const branch = env.TEAM_BRANCH?.trim() || "main";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(branch)) {
    throw new Error("TEAM_BRANCH must be a simple branch name, e.g. main.");
  }
  const provider = required(env, "LLM_PROVIDER");
  const providerConfig = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : undefined;
  if (!providerConfig) throw new Error(`Supported LLM_PROVIDER values: ${Object.keys(PROVIDERS).join(", ")}.`);
  const id = required(env, "LLM_MODEL");
  const model = provider === "azure" ? azureChatModel(env, id)
    : getModel(provider as Parameters<typeof getModel>[0], id as never) as Model<Api> | undefined;
  if (!model) throw new Error(`LLM_MODEL is not in the pinned Pi catalog for ${provider}.`);
  if (!["openai-completions", "openai-responses", "anthropic-messages"].includes(model.api)) {
    throw new Error("This image supports Chat Completions, Responses, and Anthropic Messages only.");
  }
  const upstream = new URL(model.baseUrl);
  if (upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.port ||
      (provider !== "azure" && !providerConfig.hosts.includes(upstream.hostname))) {
    throw new Error("Model endpoint is not an approved provider endpoint.");
  }
  const thinking = env.LLM_THINKING?.trim() || "medium";
  if (!["off", "minimal", "low", "medium", "high"].includes(thinking)) {
    throw new Error("LLM_THINKING must be off, minimal, low, medium, or high.");
  }
  // Anthropic's SDK adds /v1/messages; the other SDKs add /chat/completions or /responses.
  const baseUrl = model.api === "anthropic-messages" ? "http://broker:8080/llm" : "http://broker:8080/llm/v1";
  const publicModel: Model<Api> = { ...model, baseUrl, input: ["text"], headers: undefined, maxTokens: Math.min(model.maxTokens, 8192) };
  return {
    team, repository, branch,
    githubToken: required(env, "GITHUB_TOKEN"),
    apiKey: required(env, providerConfig.key),
    model,
    publicConfig: { team, model: publicModel, thinking: thinking as PublicConfig["thinking"] },
  };
}
