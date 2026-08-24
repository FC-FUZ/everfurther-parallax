// Header state + section reveal animations.
const header = document.getElementById("siteHeader");
const onScroll = () => header.classList.toggle("scrolled", scrollY > 40);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Scroll-synced story beats over the hero sequence. Each beat declares a
// [data-from, data-to] progress window; exactly the beats whose window
// contains the current scrub progress are shown.
const splash = document.querySelector(".splash-sequence");
const beats = splash ? [...splash.querySelectorAll(".story-beat")] : [];
if (splash && beats.length) {
  const windows = beats.map((el) => ({
    el,
    from: parseFloat(el.dataset.from ?? "0"),
    to: parseFloat(el.dataset.to ?? "1"),
  }));
  const updateBeats = () => {
    if (splash.dataset.mode === "static") return; // fallback shows opener only
    const rect = splash.getBoundingClientRect();
    const range = rect.height - innerHeight;
    const p = range > 0 ? Math.min(1, Math.max(0, -rect.top / range)) : 0;
    for (const { el, from, to } of windows) {
      el.classList.toggle("is-active", p >= from && p <= to);
    }
  };
  addEventListener("scroll", updateBeats, { passive: true });
  addEventListener("resize", updateBeats, { passive: true });
  updateBeats();
}

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const reveals = document.querySelectorAll(".reveal");
if (reduced || !("IntersectionObserver" in window)) {
  reveals.forEach((el) => el.classList.add("visible"));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  reveals.forEach((el) => io.observe(el));
}
