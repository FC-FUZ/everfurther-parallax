// Sequence-manifest loading + helpers. Framework-independent ES module.
// Contract: references/sequence-manifest.schema.json (schemaVersion 1).

/** Fetch and minimally validate a v1 sequence manifest. */
export async function loadManifest(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status} ${url}`);
  const manifest = await res.json();
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`invalid manifest: ${errors.join("; ")}`);
  return manifest;
}

/** Cheap structural validation — consumers must tolerate unknown keys. */
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== "object") return ["not an object"];
  if (m.schemaVersion !== 1) errors.push(`unsupported schemaVersion ${m.schemaVersion}`);
  if (!Number.isInteger(m.frameCount) || m.frameCount < 1) errors.push("bad frameCount");
  if (!m.profiles || typeof m.profiles !== "object" || Object.keys(m.profiles).length === 0) {
    errors.push("no profiles");
  } else {
    for (const [name, p] of Object.entries(m.profiles)) {
      if (!p.filenamePattern || typeof p.filenamePattern !== "string") errors.push(`${name}: missing filenamePattern`);
      if (!Number.isInteger(p.frameCount) || p.frameCount < 1) errors.push(`${name}: bad frameCount`);
      if (!Number.isInteger(p.width) || p.width < 1) errors.push(`${name}: bad width`);
    }
  }
  if (!m.poster || typeof m.poster.path !== "string") errors.push("missing poster");
  return errors;
}

/** Resolve a frame URL for a 0-based sequence position. */
export function frameUrl(baseUrl, manifest, profileName, position) {
  const profile = manifest.profiles[profileName];
  const index = (manifest.startIndex ?? 1) + position;
  const padded = String(index).padStart(manifest.framePad ?? 4, "0");
  return joinUrl(baseUrl, profile.filenamePattern.replace("{index}", padded));
}

export function posterUrl(baseUrl, manifest) {
  return joinUrl(baseUrl, manifest.poster.path);
}

/** Approximate decoded bytes for one frame of a profile (RGBA). */
export function decodedBytesPerFrame(profile) {
  if (profile.decodedBytesApprox && profile.frameCount) {
    return Math.ceil(profile.decodedBytesApprox / profile.frameCount);
  }
  const h = profile.height ?? Math.round((profile.width * 9) / 16);
  return profile.width * h * 4;
}

export function joinUrl(base, rel) {
  if (/^([a-z]+:)?\/\//i.test(rel) || rel.startsWith("/")) return rel;
  if (!base) return rel;
  return base.endsWith("/") ? base + rel : `${base}/${rel}`;
}
