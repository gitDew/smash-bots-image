import { mkdir, readFile, stat, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
import { zipSync, strToU8 } from "fflate";
import { eventConfig } from "./event-config.mjs";
import { validateRelease, SERVICES } from "./release-format.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function runtimeCompose(source, team, release) {
  const result = parse(source);
  result.name = `smash-${team.config.team}`;
  if (Object.keys(result.services).sort().join() !== [...SERVICES].sort().join()) throw new Error("Unexpected Compose services; refusing to package.");
  for (const name of SERVICES) {
    const service = result.services[name];
    delete service.build;
    service.image = release.images[name];
    service.platform = team.platform;
    if (name === "broker") {
      service.env_file = [{ path: "credentials.env", format: "raw" }];
      if (Object.keys(service.environment).some((key) => !["PI_OFFLINE", "PI_TELEMETRY", "PI_SKIP_VERSION_CHECK", "EXPECTED_TEAM_ID"].includes(key)))
        throw new Error("Broker credentials must remain in the private env file, not Compose environment.");
      service.environment.EXPECTED_TEAM_ID = team.config.team;
    }
    if (name === "agent") service.environment.TERM = "xterm-256color";
    if (service.read_only !== true || !same(service.cap_drop, ["ALL"]) ||
        !same(service.security_opt, ["no-new-privileges:true"]) || !service.init ||
        service.privileged || service.ports || service.devices || service.extra_hosts ||
        !service.mem_limit || !service.pids_limit || !service.cpus)
      throw new Error("Required container isolation is missing; refusing to package.");
  }
  const { agent, broker, validator } = result.services;
  if (agent.env_file || agent.volumes || agent.cap_add || !same(agent.networks, ["private"]) ||
      agent.user !== "1000:1000" || broker.user !== "1000:1000" || broker.cap_add ||
      !same(broker.networks, ["private", "outbound"]) || !same(broker.volumes, ["state:/state", "jobs:/jobs"]) ||
      validator.user !== "0:1000" || validator.network_mode !== "none" || validator.networks ||
      !same(validator.volumes, ["jobs:/jobs"]) || !same(validator.cap_add, ["SETUID", "SETGID", "KILL"]) ||
      result.networks.private.internal !== true)
    throw new Error("Unexpected network/credential/filesystem exposure; refusing to package.");
  if (Object.keys(agent.environment).some((key) => !["PI_OFFLINE", "PI_TELEMETRY", "PI_SKIP_VERSION_CHECK", "TERM"].includes(key)) ||
      validator.environment || validator.env_file) throw new Error("Agent/validator credentials must never be packaged.");
  return result;
}

export async function bundleFiles(root, team, release) {
  const windows = team.platform === "linux/amd64";
  const launchName = windows ? "launch.ps1" : "launch.sh";
  const launch = (await readFile(join(root, "templates", launchName), "utf8")).replaceAll("__TEAM__", team.config.team);
  const compose = runtimeCompose(await readFile(join(root, "compose.yaml"), "utf8"), team, release);
  const credentials = Object.entries(team.credentials).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  const setup = windows ? ".\\launch.ps1 -Action setup" : "sh launch.sh setup";
  const start = windows ? ".\\launch.ps1" : "sh launch.sh";
  return {
    "compose.yaml": stringify(compose),
    // Explicit nonsecret --env-file avoids automatic .env discovery/interpolation.
    "runtime.env": `# Public launcher metadata; credentials.env is loaded RAW by the broker only.\nEVENT_TEAM_ID=${team.config.team}\nEVENT_PLATFORM=${team.platform}\n`,
    "credentials.env": credentials,
    [launchName]: windows ? launch.replace(/\r?\n/g, "\r\n") : launch,
    "README.txt": `${team.config.team} — ${windows ? "Windows Intel" : "Apple Silicon"} — ${release.version}\n\nInstall/start Docker Desktop first (Linux containers; WSL2 on Windows).\nOpen a terminal in this folder. One-time preparation:\n  ${setup}\nThen launch Pi:\n  ${start}\n\nNo local image builds, Git/Python/Pi installation, desktop shortcuts, or registry login are needed.\nThe package must be public on GHCR before setup. Start reuses downloaded digest-pinned images.\nYour draft survives restarts; stop/down keeps volumes. Chat is temporary.\nCheck broker logs if GitHub rejects access. Test one live prompt/submission before the event.\n\nPRIVATE: credentials.env contains only this team's GitHub token and the shared model key.\nDo not upload this folder/ZIP to GitHub or share it with other teams. Revoke keys after the event.\nIf Windows policy blocks scripts, follow your IT policy; this launcher does not change it.\n`,
  };
}

export async function generateBundles({ configPath, releasePath, output, root = ROOT }) {
  const info = await stat(configPath);
  if (process.platform !== "win32" && (info.mode & 0o077)) throw new Error("Protect the master config first: chmod 600 .env.event");
  const config = eventConfig(await readFile(configPath, "utf8"));
  let metadata;
  try { metadata = JSON.parse(await readFile(releasePath, "utf8")); }
  catch { throw new Error("A valid release.json from the image release workflow is required before generating bundles."); }
  const release = validateRelease(metadata, config.imagePrefix, config.version);
  // Do not silently replace existing credentials/assignments. Choose a new output folder to regenerate.
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  try {
    for (const team of config.teams) {
      const id = team.config.team;
      const files = await bundleFiles(root, team, release);
      const directory = join(output, id);
      await mkdir(directory, { mode: 0o700 });
      const archive = Object.create(null);
      for (const [name, content] of Object.entries(files)) {
        const mode = name === "credentials.env" ? 0o600 : name === "launch.sh" ? 0o755 : 0o644;
        await writeFile(join(directory, name), content, { mode, flag: "wx" });
        archive[`${id}/${name}`] = [strToU8(content), { os: 3, attrs: (0o100000 | mode) << 16 }];
      }
      await writeFile(join(output, `${id}.zip`), zipSync(archive, { level: 6 }), { mode: 0o600, flag: "wx" });
    }
  } catch (error) {
    await rm(output, { recursive: true, force: true }); // Never leave partial credential bundles.
    throw error;
  }
  return { output, teams: config.teams.map((team) => team.config.team) };
}

async function main() {
  const [command = "check", ...args] = process.argv.slice(2);
  if (!["check", "generate"].includes(command)) throw new Error("Use bundles.mjs check|generate.");
  const options = { config: ".env.event", release: "release.json", output: "" };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2);
    if (!args[index]?.startsWith("--") || !Object.hasOwn(options, key) || !args[index + 1]) throw new Error("Use --config, --release, or --output followed by a path.");
    options[key] = args[index + 1];
  }
  const configPath = resolve(options.config);
  if (command === "check") {
    const info = await stat(configPath);
    if (process.platform !== "win32" && (info.mode & 0o077)) throw new Error("Protect the master config first: chmod 600 .env.event");
    const config = eventConfig(await readFile(configPath, "utf8"));
    console.log(`Configuration valid: ${config.version}, four distinct repositories/tokens, three Windows Intel and one Apple Silicon team. No credentials displayed; remote permissions not tested.`);
    return;
  }
  const config = eventConfig(await readFile(configPath, "utf8"));
  const result = await generateBundles({ configPath, releasePath: resolve(options.release), output: resolve(options.output || join("bundles", config.version)) });
  console.log(`Created ${result.teams.length} PRIVATE team folders/ZIPs in ${result.output}. Do not upload them as release assets.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Filesystem errors expose paths, not content; all configuration errors are value-free.
    console.error(error.code === "EEXIST" ? "Output already exists; choose a new --output folder. Existing credentials were preserved." : error.code === "ENOENT" ? "Configuration/release file missing. Run make init-event and download release.json first." : error.message);
    process.exitCode = 1;
  });
}
