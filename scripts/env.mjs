// Literal admin configuration, never a shell script or dotenv interpolation source.
export function parseEnv(text) {
  const result = Object.create(null);
  for (const [index, original] of text.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid configuration syntax on line ${index + 1}; use KEY=value.`);
    const [, key] = match;
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate configuration field ${key}.`);
    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      if (value.at(-1) !== value[0] || value.length < 2) throw new Error(`Unclosed quote in ${key}.`);
      value = value.slice(1, -1); // Literal: do not expand $, backticks, or escapes.
    }
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error(`Control characters are not allowed in ${key}.`);
    result[key] = value;
  }
  return result;
}

export function placeholder(value) {
  return !value || value.includes("replace-with-") || /^\*+$/.test(value);
}
