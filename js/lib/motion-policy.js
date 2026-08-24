// Motion policy: resolves the effective motion mode and tracks live changes.
// motionPreference: "auto" (default) | "full" | "reduced".
// "auto" follows prefers-reduced-motion and responds dynamically to changes.

export function createMotionPolicy({ motionPreference = "auto", onChange } = {}) {
  const query = typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  let preference = motionPreference;

  const resolve = () => {
    if (preference === "full") return "full";
    if (preference === "reduced") return "reduced";
    return query && query.matches ? "reduced" : "full";
  };

  let current = resolve();

  const handle = () => {
    const next = resolve();
    if (next !== current) {
      current = next;
      if (onChange) onChange(next);
    }
  };

  if (query) {
    if (query.addEventListener) query.addEventListener("change", handle);
    else if (query.addListener) query.addListener(handle); // older Safari
  }

  return {
    get mode() { return current; },
    setPreference(next) {
      preference = next;
      handle();
    },
    destroy() {
      if (!query) return;
      if (query.removeEventListener) query.removeEventListener("change", handle);
      else if (query.removeListener) query.removeListener(handle);
    },
  };
}

/** Optional, non-authoritative network/device signals. All may be undefined —
 * runtime measurements take priority over device classification. */
export function readEnvironmentSignals() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  return {
    saveData: conn ? Boolean(conn.saveData) : undefined,
    effectiveType: conn ? conn.effectiveType : undefined,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    viewportWidth: typeof innerWidth === "number" ? innerWidth : undefined,
    viewportHeight: typeof innerHeight === "number" ? innerHeight : undefined,
    devicePixelRatio: typeof devicePixelRatio === "number" ? devicePixelRatio : undefined,
  };
}
