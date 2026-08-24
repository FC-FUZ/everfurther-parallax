// Vanilla parallax splash — manifest-driven, adaptive, no framework, no
// animation library. Progressive enhancement:
//
//   canvas-sequence  — scroll-scrubbed frame sequence on <canvas>
//   static           — poster + full semantic content (reduced motion,
//                       manifest failure, or missing canvas support)
//
// Controller contract (framework-neutral):
//   mount(container) -> Promise<void>
//   setProgress(p)   -> void        // 0..1, clamped
//   resize()         -> void
//   suspend()        -> void
//   resume()         -> void
//   destroy()        -> void
//
// Usage: <section class="splash-sequence" data-manifest="/frames/sequence-manifest.json">
// Auto-initializes every .splash-sequence[data-manifest] on module load.

import { loadManifest, posterUrl } from "./lib/manifest.js";
import { createMotionPolicy, readEnvironmentSignals } from "./lib/motion-policy.js";
import { selectProfile, fallbackProfile } from "./lib/profile-selector.js";
import { createFrameLoader } from "./lib/frame-loader.js";
import { createScheduler } from "./lib/scheduler.js";
import { createCanvasRenderer, DEFAULT_DPR_CAP } from "./lib/canvas-renderer.js";

export const CONTROLLER_DEFAULTS = {
  breakpoint: 768,
  dprCap: DEFAULT_DPR_CAP,
  offscreenMargin: "200px",
};

export function createParallaxController(options = {}) {
  const {
    manifestUrl,
    baseUrl: baseUrlOption,
    posterSrc,
    motionPreference = "auto",
    smoothing = 0,
    breakpoint = CONTROLLER_DEFAULTS.breakpoint,
    dprCap = CONTROLLER_DEFAULTS.dprCap,
    memoryBudgetBytes,
    maxConcurrency,
    preloadAhead,
    preloadBehind,
    onReady,
    onError,
    onProgress,
    onProfileSelected,
    onModeChange,
  } = options;

  let container = null;
  let canvas = null;
  let posterEl = null;
  let manifest = null;
  let baseUrl = baseUrlOption ?? deriveBaseUrl(manifestUrl);
  let mode = "loading"; // canvas-sequence | static | loading | failed
  let profileName = null;
  let loader = null;
  let scheduler = null;
  let renderer = null;
  let motion = null;
  let io = null;
  let offscreen = false;
  let userSuspended = false;
  let destroyed = false;
  let readyFired = false;
  const cleanups = [];           // sequence-scoped (scroll, IO, renderer…)
  const persistentCleanups = []; // live until destroy() (motion policy, visibility)

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    if (container) container.dataset.mode = next;
    if (onModeChange) onModeChange(next);
  }

  function showPoster(url) {
    if (!posterEl || !url) return;
    if (!posterEl.getAttribute("src")) posterEl.setAttribute("src", url);
    posterEl.style.opacity = "1";
  }

  function hidePoster() {
    if (posterEl) posterEl.style.opacity = "0";
  }

  function enterStatic(reason) {
    // Static is a complete mode: poster (or nothing but semantic content),
    // no tall pinned section, no scroll listeners, no sequence downloads.
    teardownSequence();
    setMode("static");
    if (posterSrc) showPoster(posterSrc);
    else if (manifest) showPoster(posterUrl(baseUrl, manifest));
    fireReady();
    if (reason instanceof Error && onError) onError(reason);
  }

  function fireReady() {
    if (!readyFired) {
      readyFired = true;
      if (onReady) onReady(mode);
    }
  }

  function teardownSequence() {
    if (loader) { loader.destroy(); loader = null; }
    if (scheduler) { scheduler.destroy(); scheduler = null; }
    if (renderer) { renderer.destroy(); renderer = null; }
    while (cleanups.length) cleanups.pop()();
  }

  function progressFromScroll() {
    const rect = container.getBoundingClientRect();
    const range = rect.height - innerHeight;
    if (range <= 0) return 0;
    return Math.min(1, Math.max(0, -rect.top / range));
  }

  function startSequence() {
    const signals = readEnvironmentSignals();
    profileName = selectProfile(manifest, {
      viewportWidth: signals.viewportWidth,
      breakpoint,
      saveData: signals.saveData,
    });
    if (onProfileSelected) onProfileSelected(profileName);
    startLoaderFor(profileName);

    renderer = createCanvasRenderer(canvas, {
      dprCap,
      onLayoutChange: () => scheduler && scheduler.invalidate(),
    });

    scheduler = createScheduler({
      frameCount: manifest.profiles[profileName].frameCount,
      smoothing,
      draw(frame) {
        const image = loader.frame(frame)
          ?? loader.frame(loader.nearestDecoded(frame)); // failed-frame fallback
        if (!image) return false;
        const ok = renderer.draw(image);
        if (ok) hidePoster();
        return ok;
      },
    });

    const onScroll = () => {
      const p = progressFromScroll();
      const prev = scheduler.progress;
      loader.setAnchor(
        Math.round(p * (manifest.profiles[profileName].frameCount - 1)),
        p >= prev ? 1 : -1,
      );
      scheduler.setProgress(p);
    };
    addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => removeEventListener("scroll", onScroll));

    io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      offscreen = !visible;
      applySuspension();
    }, { rootMargin: CONTROLLER_DEFAULTS.offscreenMargin });
    io.observe(container);
    cleanups.push(() => { io.disconnect(); io = null; });

    // Synchronous initial check so no frame request fires while the
    // sequence is still far from the viewport (IO callbacks are async).
    const margin = parseInt(CONTROLLER_DEFAULTS.offscreenMargin, 10) || 0;
    const rect = container.getBoundingClientRect();
    offscreen = rect.top > innerHeight + margin || rect.bottom < -margin;
    applySuspension();

    setMode("canvas-sequence");
    onScroll(); // establish initial anchor + draw
  }

  function startLoaderFor(name) {
    const viewportClass = manifest.profiles[name].viewportClass ?? "desktop";
    loader = createFrameLoader({
      baseUrl,
      manifest,
      profileName: name,
      viewportClass,
      memoryBudgetBytes,
      maxConcurrency,
      preloadAhead,
      preloadBehind,
      onFrameDecoded(position) {
        if (scheduler && position === scheduler.currentFrame) scheduler.invalidate();
        if (!readyFired && scheduler && position === scheduler.currentFrame) fireReady();
      },
      onProgress,
      onSustainedFailure() {
        const next = fallbackProfile(manifest, name);
        if (next) downgrade(next);
        else enterStatic(new Error("sequence loading failed repeatedly"));
      },
    });
  }

  function downgrade(nextName) {
    const anchor = scheduler ? scheduler.currentFrame : 0;
    if (loader) loader.destroy();
    profileName = nextName;
    if (onProfileSelected) onProfileSelected(nextName);
    startLoaderFor(nextName);
    loader.setAnchor(anchor, 1);
    if (scheduler) scheduler.invalidate();
  }

  function applySuspension() {
    if (!loader || !scheduler) return;
    if (offscreen || userSuspended || document.hidden) {
      loader.suspend();
      scheduler.suspend();
    } else {
      loader.resume();
      scheduler.resume();
    }
  }

  return {
    async mount(target) {
      container = target;
      canvas = container.querySelector(".sequence-canvas");
      posterEl = container.querySelector(".sequence-poster");
      container.dataset.mode = mode;

      motion = createMotionPolicy({
        motionPreference,
        onChange: async (m) => {
          if (destroyed) return;
          if (m === "reduced") { enterStatic(); return; }
          if (!manifest) {
            try {
              manifest = await loadManifest(manifestUrl);
            } catch (err) {
              enterStatic(err instanceof Error ? err : new Error(String(err)));
              return;
            }
            if (destroyed) return;
          }
          if (canvas) { setMode("loading"); startSequence(); }
        },
      });
      persistentCleanups.push(() => motion && motion.destroy());

      const onVisibility = () => applySuspension();
      document.addEventListener("visibilitychange", onVisibility);
      persistentCleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

      // Reduced motion: never download the sequence; poster + semantics only.
      if (motion.mode === "reduced") {
        if (posterSrc) { enterStatic(); return; }
        // Need the manifest only to locate the poster.
        try {
          manifest = await loadManifest(manifestUrl);
        } catch (err) { /* poster unavailable; semantic content still stands */ }
        enterStatic();
        return;
      }

      if (posterSrc) showPoster(posterSrc); // poster-first, non-blocking

      try {
        manifest = await loadManifest(manifestUrl);
      } catch (err) {
        enterStatic(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (destroyed) return;
      if (!posterSrc) showPoster(posterUrl(baseUrl, manifest));

      if (!canvas || !canvas.getContext || !canvas.getContext("2d")) {
        enterStatic();
        return;
      }
      startSequence();
    },

    setProgress(p) {
      if (scheduler && loader) {
        const clamped = Math.min(1, Math.max(0, p));
        loader.setAnchor(
          Math.round(clamped * (manifest.profiles[profileName].frameCount - 1)),
          clamped >= scheduler.progress ? 1 : -1,
        );
        scheduler.setProgress(clamped);
      }
    },

    resize() {
      if (renderer && renderer.measure() && scheduler) scheduler.invalidate();
    },

    suspend() { userSuspended = true; applySuspension(); },
    resume() { userSuspended = false; applySuspension(); },

    destroy() {
      destroyed = true;
      teardownSequence();
      while (persistentCleanups.length) persistentCleanups.pop()();
      if (container) delete container.dataset.mode;
      container = null;
      canvas = null;
      posterEl = null;
    },

    /** Introspection for tests and debugging. */
    getDebugState() {
      return {
        mode,
        profileName,
        progress: scheduler ? scheduler.progress : 0,
        currentFrame: scheduler ? scheduler.currentFrame : -1,
        renderedFrame: scheduler ? scheduler.renderedFrame : -1,
        pendingRaf: scheduler ? scheduler.hasPendingFrame : false,
        loader: loader ? loader.stats : null,
        canvasSize: renderer ? renderer.size : null,
        offscreen,
      };
    },
  };
}

function deriveBaseUrl(manifestUrl) {
  if (!manifestUrl) return "";
  const i = manifestUrl.lastIndexOf("/");
  return i === -1 ? "" : manifestUrl.slice(0, i + 1);
}

// --- Auto-init ---------------------------------------------------------------

export function initAll(root = document) {
  const controllers = [];
  root.querySelectorAll(".splash-sequence[data-manifest]").forEach((section) => {
    const controller = createParallaxController({
      manifestUrl: section.dataset.manifest,
      posterSrc: section.dataset.poster || undefined,
      motionPreference: section.dataset.motion || "auto",
      dprCap: section.dataset.dprCap ? Number(section.dataset.dprCap) : undefined,
      memoryBudgetBytes: section.dataset.memoryBudgetMb
        ? Number(section.dataset.memoryBudgetMb) * 1024 * 1024
        : undefined,
      smoothing: section.dataset.smoothing ? Number(section.dataset.smoothing) : undefined,
    });
    controller.mount(section);
    controllers.push(controller);
  });
  return controllers;
}

if (typeof document !== "undefined" && !globalThis.__PARALLAX_NO_AUTOINIT__) {
  globalThis.__parallaxControllers = initAll();
}
