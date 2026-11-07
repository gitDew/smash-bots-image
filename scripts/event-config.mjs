import { loadConfig, providerApiKeyName } from "../dist/config.js";
import { parseEnv, placeholder } from "./env.mjs";
import { validateCoordinates, PLATFORMS } from "./release-format.mjs";

export function eventConfig(text) {
  const env = parseEnv(text);
  const allowed = new Set(["IMAGE_PREFIX", "IMAGE_TAG", "LLM_PROVIDER", "LLM_MODEL", "LLM_THINKING",
    "OPENCODE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
    "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL"]);
  for (const letter of "ABCD") for (const key of ["REPO_URL", "BRANCH", "GITHUB_TOKEN", "PLATFORM"])
    allowed.add(`TEAM_${letter}_${key}`);
  if (Object.keys(env).some((key) => !allowed.has(key))) throw new Error("Unknown field in the master event config; use .env.event.example.");
  validateCoordinates(env.IMAGE_PREFIX, env.IMAGE_TAG);
  const keyName = providerApiKeyName(env.LLM_PROVIDER || "");
  if (placeholder(env[keyName])) throw new Error(`Fill in ${keyName} locally.`);
  const teams = [..."ABCD"].map((letter) => {
    const key = `TEAM_${letter}_GITHUB_TOKEN`;
    if (placeholder(env[key]) || !env[key].startsWith("github_pat_"))
      throw new Error(`Fill in ${key} with a fine-grained GitHub token locally.`);
    const platform = env[`TEAM_${letter}_PLATFORM`];
    if (!PLATFORMS.includes(platform)) throw new Error(`TEAM_${letter}_PLATFORM must be linux/amd64 or linux/arm64.`);
    const config = loadConfig({
      TEAM_ID: `team_${letter.toLowerCase()}`, TEAM_REPO_URL: env[`TEAM_${letter}_REPO_URL`],
      TEAM_BRANCH: env[`TEAM_${letter}_BRANCH`] || "main", GITHUB_TOKEN: env[key],
      LLM_PROVIDER: env.LLM_PROVIDER, LLM_MODEL: env.LLM_MODEL, LLM_THINKING: env.LLM_THINKING,
      AZURE_OPENAI_BASE_URL: env.AZURE_OPENAI_BASE_URL, [keyName]: env[keyName],
    });
    return { config, platform, credentials: {
      TEAM_ID: config.team, TEAM_REPO_URL: config.repository, TEAM_BRANCH: config.branch,
      GITHUB_TOKEN: config.githubToken, LLM_PROVIDER: config.model.provider,
      LLM_MODEL: config.model.id, LLM_THINKING: config.publicConfig.thinking, [keyName]: config.apiKey,
      ...(config.model.provider === "azure" ? { AZURE_OPENAI_BASE_URL: config.model.baseUrl } : {}),
    } };
  });
  if (teams.filter((team) => team.platform === "linux/amd64").length !== 3)
    throw new Error("Assign exactly three Windows Intel teams and one Apple Silicon team.");
  if (new Set(teams.map((team) => team.config.repository)).size !== 4)
    throw new Error("Each team must have a different repository.");
  if (new Set(teams.map((team) => team.config.githubToken)).size !== 4)
    throw new Error("Each team must have a different, repository-scoped GitHub token.");
  return { imagePrefix: env.IMAGE_PREFIX, version: env.IMAGE_TAG, teams };
}
