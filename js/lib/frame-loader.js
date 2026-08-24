// Adaptive frame loader: directional sliding window over a bounded LRU cache,
// capped network concurrency, AbortController cancellation, retry limits, and
// sustained-failure escalation for profile downgrades. Never preloads the
// whole sequence.

import { createFrameCache } from "./frame-cache.js";
import { decodedBytesPerFrame, frameUrl } from "./manifest.js";

export const LOADER_DEFAULTS = {
  maxConcurrency: 4,
  preloadAhead: 12,
  preloadBehind: 4,
  maxRetries: 2,
  sustainedFailureThreshold: 8,
  // Decoded-memory budgets (bytes). Selected by viewport class at creation.
  memoryBudgetBytes: {
    mobile: 96 * 1024 * 1024,
    desktop: 192 * 1024 * 1024,
  },
};

export function createFrameLoader({
  baseUrl,
  manifest,
  profileName,
  viewportClass = "desktop",
  maxConcurrency = LOADER_DEFAULTS.maxConcurrency,
  preloadAhead = LOADER_DEFAULTS.preloadAhead,
  preloadBehind = LOADER_DEFAULTS.preloadBehind,
  maxRetries = LOADER_DEFAULTS.maxRetries,
  sustainedFailureThreshold = LOADER_DEFAULTS.sustainedFailureThreshold,
  memoryBudgetBytes,
  onFrameDecoded,       // (position) => void
  onSustainedFailure,   // () => void — caller should downgrade profile
  onProgress,           // (decodedCount, windowSize) => void
} = {}) {
  const profile = manifest.profiles[profileName];
  const frameCount = profile.frameCount;
  const bytesPerFrame = decodedBytesPerFrame(profile);
  const budget = memoryBudgetBytes
    ?? LOADER_DEFAULTS.memoryBudgetBytes[viewportClass]
    ?? LOADER_DEFAULTS.memoryBudgetBytes.desktop;

  const cache = createFrameCache({ maxBytes: budget, bytesPerFrame });
  const inflight = new Map();   // position -> AbortController
  const retries = new Map();    // position -> attempts
  const failed = new Set();     // positions past retry limit
  let consecutiveFailures = 0;
  let direction = 1;            // +1 forward, -1 backward
  let anchor = 0;               // current frame position
  let suspended = false;
  let destroyed = false;

  const supportsBitmap = typeof createImageBitmap === "function";

  async function decode(position, signal) {
    const url = frameUrl(baseUrl, manifest, profileName, position);
    if (supportsBitmap) {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`frame fetch ${res.status}`);
      const blob = await res.blob();
      return createImageBitmap(blob);
    }
    // HTMLImageElement fallback (no fetch — lets the browser cache work).
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      const abort = () => { img.src = ""; reject(new DOMException("aborted", "AbortError")); };
      if (signal) {
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("frame decode failed"));
      img.src = url;
    });
  }

  function desiredWindow() {
    const ahead = direction >= 0 ? preloadAhead : preloadBehind;
    const behind = direction >= 0 ? preloadBehind : preloadAhead;
    const positions = [];
    // Priority: current frame, then outward in scroll direction, then behind.
    if (valid(anchor)) positions.push(anchor);
    for (let d = 1; d <= Math.max(ahead, behind); d++) {
      const fwd = anchor + d * (direction >= 0 ? 1 : -1);
      const back = anchor - d * (direction >= 0 ? 1 : -1);
      if (d <= ahead && valid(fwd)) positions.push(fwd);
      if (d <= behind && valid(back)) positions.push(back);
    }
    return positions;
  }

  function valid(p) { return p >= 0 && p < frameCount; }

  function pump() {
    if (suspended || destroyed) return;
    const wanted = desiredWindow();
    const wantedSet = new Set(wanted);

    // Cancel fetches that fell out of the window (rapid direction changes).
    for (const [position, controller] of inflight) {
      if (!wantedSet.has(position)) {
        controller.abort();
        inflight.delete(position);
      }
    }

    for (const position of wanted) {
      if (inflight.size >= maxConcurrency) break;
      if (cache.has(position) || inflight.has(position) || failed.has(position)) continue;
      start(position);
    }

    if (onProgress) {
      const decoded = wanted.filter((p) => cache.has(p)).length;
      onProgress(decoded, wanted.length);
    }
  }

  function start(position) {
    const controller = new AbortController();
    inflight.set(position, controller);
    decode(position, controller.signal).then(
      (image) => {
        inflight.delete(position);
        if (destroyed) {
          if (image && typeof image.close === "function") image.close();
          return;
        }
        consecutiveFailures = 0;
        retries.delete(position);
        cache.set(position, image);
        if (onFrameDecoded) onFrameDecoded(position);
        pump();
      },
      (err) => {
        inflight.delete(position);
        if (destroyed || (err && err.name === "AbortError")) return;
        const attempts = (retries.get(position) ?? 0) + 1;
        retries.set(position, attempts);
        consecutiveFailures += 1;
        if (attempts > maxRetries) failed.add(position);
        if (consecutiveFailures >= sustainedFailureThreshold && onSustainedFailure) {
          const cb = onSustainedFailure;
          consecutiveFailures = 0;
          cb();
          return;
        }
        pump();
      },
    );
  }

  return {
    /** Move the window anchor; called on every frame-index change. */
    setAnchor(position, dir) {
      anchor = Math.max(0, Math.min(frameCount - 1, position));
      if (dir === 1 || dir === -1) direction = dir;
      pump();
    },
    /** Decoded frame for a position, or null. */
    frame(position) {
      return cache.get(position);
    },
    /** Nearest decoded frame position to `position`, or -1. */
    nearestDecoded(position) {
      return cache.nearest(position);
    },
    suspend() {
      suspended = true;
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
    },
    resume() {
      if (destroyed) return;
      suspended = false;
      pump();
    },
    destroy() {
      destroyed = true;
      suspended = true;
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
      cache.clear();
      retries.clear();
      failed.clear();
    },
    get stats() {
      return {
        cachedFrames: cache.size,
        cachedBytes: cache.bytes,
        budgetBytes: budget,
        inflight: inflight.size,
        failedFrames: failed.size,
        profileName,
      };
    },
  };
}
