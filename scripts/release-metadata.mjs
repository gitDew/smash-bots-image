// CI-only registry metadata. No event config or team credentials are read here.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SERVICES, PLATFORMS, validateCoordinates, validateRelease } from "./release-format.mjs";

const docker = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const inspectDigest = (ref, run) => {
  const match = /^Digest:\s+(sha256:[a-f0-9]{64})\s*$/m.exec(run(["buildx", "imagetools", "inspect", ref]));
  if (!match) throw new Error("Could not resolve a registry manifest digest.");
  return match[1];
};

export function architectureMetadata({ imagePrefix, version, commit, arch }, run = docker) {
  validateCoordinates(imagePrefix, version);
  if (!/^[a-f0-9]{40}$/.test(commit) || !["amd64", "arm64"].includes(arch)) throw new Error("Invalid release source commit/architecture.");
  return {
    schema: 1, imagePrefix, version, commit, arch, platform: `linux/${arch}`,
    images: Object.fromEntries(SERVICES.map((service) => [service, `${imagePrefix}@${inspectDigest(`${imagePrefix}:${service}-${version}-${arch}`, run)}`])),
  };
}

export function mergeMetadata(amd64, arm64, run = docker) {
  validateCoordinates(amd64?.imagePrefix, amd64?.version);
  const { imagePrefix, version, commit } = amd64;
  for (const [arch, metadata] of [["amd64", amd64], ["arm64", arm64]]) {
    if (!metadata || metadata.schema !== 1 || metadata.imagePrefix !== imagePrefix || metadata.version !== version ||
        metadata.commit !== commit || !/^[a-f0-9]{40}$/.test(commit) || metadata.arch !== arch ||
        metadata.platform !== `linux/${arch}` || !metadata.images ||
        Object.keys(metadata.images).sort().join() !== [...SERVICES].sort().join()) throw new Error("Architecture metadata must come from the same tested source/version.");
    for (const service of SERVICES) {
      const ref = metadata.images[service];
      if (typeof ref !== "string" || !ref.startsWith(`${imagePrefix}@sha256:`) ||
          !/^[a-f0-9]{64}$/.test(ref.slice(`${imagePrefix}@sha256:`.length))) throw new Error("Invalid architecture image digest.");
    }
  }
  const images = {};
  for (const service of SERVICES) {
    const tag = `${imagePrefix}:${service}-${version}`;
    run(["buildx", "imagetools", "create", "--tag", tag, amd64.images[service], arm64.images[service]]);
    images[service] = `${tag}@${inspectDigest(tag, run)}`;
  }
  return validateRelease({ schema: 1, imagePrefix, version, commit, platforms: PLATFORMS, images }, imagePrefix, version);
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith("--") || !args[index + 1]) throw new Error("Expected named release arguments.");
    values[args[index].slice(2)] = args[index + 1];
  }
  let result;
  if (mode === "architecture") result = architectureMetadata({ imagePrefix: values.prefix, version: values.version, commit: values.commit, arch: values.arch });
  else if (mode === "merge") result = mergeMetadata(JSON.parse(await readFile(values.amd64, "utf8")), JSON.parse(await readFile(values.arm64, "utf8")));
  else throw new Error("Use architecture or merge.");
  const path = resolve(values.output || "release.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2) + "\n");
  console.log(`Wrote credential-free image metadata to ${path}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Release metadata failed; no event credentials were accessed."); process.exitCode = 1; });
}
