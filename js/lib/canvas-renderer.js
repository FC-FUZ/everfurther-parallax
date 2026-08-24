// Canvas renderer: DPR-capped backing store, object-fit:cover drawing, and
// layout-change tracking via ResizeObserver + orientation/visualViewport.
// Canvas dimensions are only touched when layout actually changes — never
// during ordinary scrolling.

export const DEFAULT_DPR_CAP = 2;

export function createCanvasRenderer(canvas, { dprCap = DEFAULT_DPR_CAP, onLayoutChange } = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let cssWidth = 0;
  let cssHeight = 0;
  let appliedDpr = 0;
  let ro = null;
  const listeners = [];

  function effectiveDpr() {
    return Math.min(dprCap, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  }

  /** Re-read layout and resize the backing store if it changed. */
  function measure() {
    const rect = canvas.getBoundingClientRect();
    const dpr = effectiveDpr();
    const changed = rect.width !== cssWidth || rect.height !== cssHeight || dpr !== appliedDpr;
    if (!changed) return false;
    cssWidth = rect.width;
    cssHeight = rect.height;
    appliedDpr = dpr;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function imageSize(image) {
    return {
      w: image.naturalWidth ?? image.width,
      h: image.naturalHeight ?? image.height,
    };
  }

  function draw(image) {
    if (!ctx || !image) return false;
    if (cssWidth === 0 || cssHeight === 0) measure();
    if (cssWidth === 0 || cssHeight === 0) return false;
    const { w: iw, h: ih } = imageSize(image);
    if (!iw || !ih) return false;
    const scale = Math.max(cssWidth / iw, cssHeight / ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.drawImage(image, (cssWidth - w) / 2, (cssHeight - h) / 2, w, h);
    return true;
  }

  function observe() {
    const notify = () => {
      if (measure() && onLayoutChange) onLayoutChange();
    };
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(notify);
      ro.observe(canvas);
    } else {
      addTracked(window, "resize", notify);
    }
    addTracked(window, "orientationchange", notify);
    if (typeof visualViewport !== "undefined" && visualViewport) {
      addTracked(visualViewport, "resize", notify);
    }
  }

  function addTracked(target, type, fn) {
    target.addEventListener(type, fn, { passive: true });
    listeners.push([target, type, fn]);
  }

  measure();
  observe();

  return {
    draw,
    measure,
    get context() { return ctx; },
    get size() { return { width: cssWidth, height: cssHeight, dpr: appliedDpr }; },
    destroy() {
      if (ro) ro.disconnect();
      ro = null;
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      listeners.length = 0;
    },
  };
}
