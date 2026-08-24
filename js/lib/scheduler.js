// Render scheduler: scroll handlers only update target progress; at most one
// requestAnimationFrame callback is ever pending; drawing is skipped when the
// computed frame has not changed.
//
// Optional temporal smoothing (`smoothing` in (0, 1]): the displayed progress
// eases toward the scroll target each animation frame instead of snapping.
// Discrete inputs (notched mouse wheels, page-down) jump many frames per
// event; easing turns those jumps into short scrub runs — the premium
// scroll-film feel. 0 (default) preserves exact snap-to-target behavior.
// The coefficient is normalized per 60fps frame and applied frame-rate
// independently, so 120Hz displays ease at the same real-time speed.

export function createScheduler({ frameCount, draw, smoothing = 0 }) {
  let targetProgress = 0;
  let displayedProgress = 0;
  let started = false;      // first tick snaps (restored scroll positions)
  let lastTick = 0;
  let renderedFrame = -1;
  let rafId = 0;
  let pending = false;
  let suspended = false;
  let destroyed = false;
  let forceNext = false;

  const frameForProgress = (p) => Math.round(p * (frameCount - 1));

  const tick = (now) => {
    pending = false;
    rafId = 0;
    if (suspended || destroyed) return;

    if (smoothing > 0 && started) {
      const dt = lastTick ? Math.min(100, now - lastTick) : 16.7;
      lastTick = now;
      const alpha = 1 - Math.pow(1 - smoothing, dt / 16.7);
      displayedProgress += (targetProgress - displayedProgress) * alpha;
      // Settle once within half a frame of the target — avoids asymptotic
      // rAF churn at rest.
      if (Math.abs(targetProgress - displayedProgress) * (frameCount - 1) < 0.5) {
        displayedProgress = targetProgress;
      }
    } else {
      displayedProgress = targetProgress;
      started = true;
    }

    const frame = frameForProgress(displayedProgress);
    if (frame !== renderedFrame || forceNext) {
      forceNext = false;
      const drawn = draw(frame, displayedProgress);
      // draw returns false when the frame image was unavailable — keep
      // renderedFrame stale so a later decode triggers a real draw.
      if (drawn !== false) renderedFrame = frame;
    }

    if (displayedProgress !== targetProgress) {
      schedule(); // keep easing toward the target
    } else {
      lastTick = 0;
    }
  };

  const schedule = () => {
    if (pending || suspended || destroyed) return;
    pending = true;
    rafId = requestAnimationFrame(tick);
  };

  return {
    /** Called from scroll handlers — cheap, never draws synchronously. */
    setProgress(p) {
      targetProgress = Math.min(1, Math.max(0, p));
      schedule();
    },
    /** Re-draw even if the frame index is unchanged (resize, decode-arrival). */
    invalidate() {
      forceNext = true;
      schedule();
    },
    suspend() {
      suspended = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      pending = false;
    },
    resume() {
      if (destroyed) return;
      suspended = false;
      // Resume re-renders the current target without replaying skipped frames.
      displayedProgress = targetProgress;
      lastTick = 0;
      forceNext = true;
      schedule();
    },
    destroy() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      pending = false;
    },
    get currentFrame() { return frameForProgress(displayedProgress); },
    get renderedFrame() { return renderedFrame; },
    get progress() { return targetProgress; },
    get hasPendingFrame() { return pending; },
  };
}
