# LXR Perf Tool

Static GitHub Pages app for Elixir weight and balance and performance planning.

## Structure

- `index.html` - page markup and app shell
- `css/main.css` - visual styling
- `js/app.js` - application logic, calculations, charts, local storage, and PDF export
- `data/aircraft.json` - aircraft registration empty mass and CG data
- `data/performance.json` - AFM/performance tables, wind factors, surface factors, CG envelope, and limits
- `data/runways.json` - runway presets loaded by the app

The project intentionally has no build step. Keep paths relative, such as
`./css/main.css`, `./js/app.js`, and `./data/*.json`, so it works when served
from a GitHub Pages project URL.
