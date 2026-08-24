# EverFurther — Parallax Concept Rebuild

A scroll-scrubbed parallax concept site inspired by [everfurther.net](https://www.everfurther.net/) —
The Next Loop Endurance Series.

The hero is a canvas frame sequence (AI-generated race footage via Higgsfield,
extracted to WebP frames with ffmpeg) scrubbed by scroll position, with a
`prefers-reduced-motion` static fallback. No frameworks, no build step —
plain HTML/CSS/ES modules.

## Run locally

```bash
python -m http.server 8080
# open http://localhost:8080
```

## Structure

- `index.html` — single page
- `css/styles.css` — design tokens extracted from the original site's palette
- `js/parallax-splash.js` + `js/lib/` — manifest-driven scroll-scrub controller
- `assets/frames/` — WebP frame sequence + `sequence-manifest.json` + poster

Built with the `parallax-web-design` skill. Race footage is AI-generated;
no assets were copied from the original site.
