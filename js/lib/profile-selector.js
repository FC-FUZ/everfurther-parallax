// Profile selection: pick the sequence profile for the current environment,
// and walk the fallback chain on sustained failure or pressure signals.

import { decodedBytesPerFrame } from "./manifest.js";

const DEFAULT_BREAKPOINT = 768;

/**
 * Pick the initial profile name.
 * Signals are optional hints only; viewport width is the primary input.
 */
export function selectProfile(manifest, {
  viewportWidth = typeof innerWidth === "number" ? innerWidth : 1280,
  breakpoint = DEFAULT_BREAKPOINT,
  saveData,
} = {}) {
  const names = Object.keys(manifest.profiles);
  const wantClass = viewportWidth >= breakpoint ? "desktop" : "mobile";

  let pick = names.find((n) => manifest.profiles[n].viewportClass === wantClass)
    || names.find((n) => manifest.profiles[n].viewportClass === "desktop")
    || names[0];

  // Data-saver hint: prefer the smaller (fallback) profile when one exists.
  if (saveData) {
    const fb = manifest.profiles[pick].fallbackProfile;
    if (fb && manifest.profiles[fb]) pick = fb;
  }
  return pick;
}

/** Next profile in the fallback chain, or null when out of options. */
export function fallbackProfile(manifest, currentName) {
  const fb = manifest.profiles[currentName]?.fallbackProfile;
  return fb && manifest.profiles[fb] && fb !== currentName ? fb : null;
}

/** Cheapest profile by decoded bytes per frame — last-resort downgrade. */
export function cheapestProfile(manifest) {
  return Object.keys(manifest.profiles).reduce((best, name) =>
    decodedBytesPerFrame(manifest.profiles[name]) < decodedBytesPerFrame(manifest.profiles[best])
      ? name : best);
}
