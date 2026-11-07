export const SERVICES = ["agent", "broker", "validator"];
export const PLATFORMS = ["linux/amd64", "linux/arm64"];

export function validateCoordinates(imagePrefix, version) {
  if (typeof imagePrefix !== "string" || !/^ghcr\.io\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(imagePrefix))
    throw new Error("IMAGE_PREFIX must be a lowercase ghcr.io/owner/image reference.");
  if (typeof version !== "string" || !/^v\d+\.\d+\.\d+$/.test(version) || version.length > 40)
    throw new Error("IMAGE_TAG must be a version such as v0.1.0, not latest/dev.");
}

export function validateRelease(value, imagePrefix, version) {
  validateCoordinates(imagePrefix, version);
  if (!value || value.schema !== 1 || value.imagePrefix !== imagePrefix || value.version !== version ||
      typeof value.commit !== "string" || !/^[a-f0-9]{40}$/.test(value.commit) ||
      !Array.isArray(value.platforms) || value.platforms.length !== 2 ||
      !PLATFORMS.every((platform) => value.platforms.includes(platform)) ||
      !value.images || Object.keys(value.images).sort().join() !== [...SERVICES].sort().join())
    throw new Error("Release metadata must match the configured image/version and contain both architectures.");
  for (const service of SERVICES) {
    const prefix = `${imagePrefix}:${service}-${version}@sha256:`;
    const ref = value.images[service];
    if (typeof ref !== "string" || !ref.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(ref.slice(prefix.length)))
      throw new Error("Every release image must have the expected name and a SHA-256 digest pin.");
  }
  return value;
}
