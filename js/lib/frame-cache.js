// Bounded LRU cache for decoded frames, accounted in approximate decoded
// bytes (RGBA). Evicted ImageBitmaps are close()d to release memory.

export function createFrameCache({ maxBytes, bytesPerFrame }) {
  const map = new Map(); // position -> { image, bytes } (Map preserves insertion order = LRU)
  let totalBytes = 0;

  const release = (entry) => {
    if (entry.image && typeof entry.image.close === "function") {
      try { entry.image.close(); } catch { /* already closed */ }
    }
  };

  return {
    get(position) {
      const entry = map.get(position);
      if (!entry) return null;
      map.delete(position); // refresh LRU order
      map.set(position, entry);
      return entry.image;
    },
    has(position) {
      return map.has(position);
    },
    set(position, image, bytes = bytesPerFrame) {
      const existing = map.get(position);
      if (existing) {
        totalBytes -= existing.bytes;
        map.delete(position);
        release(existing);
      }
      map.set(position, { image, bytes });
      totalBytes += bytes;
      // Evict least-recently-used until under budget (never evict the newest).
      for (const [key, entry] of map) {
        if (totalBytes <= maxBytes || map.size <= 1) break;
        if (key === position) continue;
        map.delete(key);
        totalBytes -= entry.bytes;
        release(entry);
      }
    },
    /** Nearest decoded position to `position`, or -1. */
    nearest(position) {
      let best = -1;
      let bestDist = Infinity;
      for (const key of map.keys()) {
        const dist = Math.abs(key - position);
        if (dist < bestDist) { bestDist = dist; best = key; }
      }
      return best;
    },
    get bytes() { return totalBytes; },
    get size() { return map.size; },
    keys() { return Array.from(map.keys()); },
    clear() {
      for (const entry of map.values()) release(entry);
      map.clear();
      totalBytes = 0;
    },
  };
}
