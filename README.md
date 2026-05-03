# LXR Perf Tool

Static browser app for Elixir weight and balance, runway performance, weather
cross-checks, and a kneeboard-friendly PDF summary.

This is an unofficial planning helper. It is not an AFM, OM-C, POH, dispatch
release, or go/no-go authority. The pilot must verify all outputs against the
current aircraft documents, published runway data, NOTAMs, weather, and local
procedures.

## Features

- Weight and balance calculation from empty aircraft data, crew, passenger,
  baggage, upholstery, and fuel.
- AFM mass/CG envelope check with a chart showing departure and landing points.
- Departure and arrival performance panels using pressure altitude, ISA
  deviation, surface condition, runway distances, wind, and OM-C factors.
- METAR and TAF fetch/parse helpers for weather minima review.
- OM-C aerodrome risk assessment display.
- Runway requirement visualisation for take-off and landing.
- Printable PDF snapshot laid out as two A5 panels on A4 landscape, intended to
  fold into a kneeboard.

## Calculation Methods

### Weight and balance

The app sums mass and moment for the empty aircraft, upholstery, pilot,
passenger, baggage, and fuel. Fuel mass is calculated from the selected AFM
fuel density: 0.72 kg/L for AVGAS 100LL or UL91, and 0.75 kg/L for Mogas
SP95/SP98/E5. It then calculates:

- Take-off mass and CG with fuel.
- Landing/no-fuel mass and CG.
- Fuel, baggage, mass, and CG limit checks.
- Point-in-polygon checks against the AFM mass/CG envelope in
  `data/performance.json`.

The envelope currently uses the AFM points shown in the app:
430 kg / 720 mm, 500 kg / 720 mm, 630 kg / 800 mm, 630 kg / 860 mm, and
430 kg / 860 mm.

### Pressure altitude and ISA deviation

Departure and arrival pressure altitude are calculated from field elevation and
QNH. ISA deviation is calculated from OAT and the ISA temperature at that
pressure altitude. Those values drive the performance table interpolation.

### AFM performance interpolation

Take-off and landing base distances are stored as digitised AFM table values in
`data/performance.json`.

- Altitude grid: 0, 2000, 4000, and 6000 ft for TOLD.
- Temperature grid: ISA, ISA+10, and ISA+20.
- Take-off table returns AFM take-off run and 50 ft take-off distance.
- Landing table returns AFM landing ground run and 50 ft landing distance.

The app linearly interpolates between altitude and temperature grid points. Rate
of climb uses its own altitude/temperature table.

### Surface factors

Surface condition changes the ground-run portion first. The app preserves the
airborne segment by splitting total distance into:

`airborne segment = AFM distance - AFM ground run`

Then it applies the configured surface factor to the ground run and adds the
airborne segment back. Current surface factors are:

- Paved dry: take-off 1.0, landing 1.0
- Paved wet: take-off 1.0, landing 1.0, treated as wet landing
- Grass dry: take-off 1.2, landing 1.2
- Grass wet: take-off 1.3, landing 1.6, treated as wet landing

### Wind correction

The app resolves wind into headwind/tailwind and crosswind using runway true
heading. METAR/TAF winds are treated as true. `VRB` wind is treated as full
tailwind for performance and crosswind is not assessed.

Performance correction uses the OM-C accountable wind component:

- Headwind credit: 50% of reported headwind component.
- Tailwind penalty: 150% of reported tailwind component.

The accountable component is capped to the digitised wind correction table
limits before interpolation:

- Headwind correction table limit: 14 kt.
- Tailwind correction table limit: 10 kt.

Wind correction factors are stored separately for take-off run, take-off
distance, landing run, and landing distance.

### OM-C runway factors

After AFM distance, surface, and wind corrections, the app derives the OM-C
runway requirements:

- Balanced-field take-off check: TORA >= 1.25 x AFM TODR.
- Declared-distance take-off checks, where stopway/clearway are relevant:
  TORA >= AFM TORR, TODA >= 1.15 x AFM TODR, and ASDA >= 1.3 x AFM TORR.
- Landing dry: LDA >= AFM LDR dry / 0.7.
- Landing wet: LDA >= AFM LDR wet x 1.15 / 0.7.

The UI keeps both dry and wet landing values visible. The active landing check
uses the selected arrival surface/weather condition.

### Weather and risk helpers

METAR and TAF parsing is intentionally limited to fields useful for quick
cross-checks: wind, visibility, cloud ceiling, temperature, QNH, and forecast
groups where parseable. The app checks parsed values against the selected OM-C
weather minima profile and flags values needing review.

IFR arrival minima, published approach minima, RVR, NOTAM effects, runway state,
and operational judgement remain outside the parser and must be verified from
authoritative sources.

## Data Files

- `data/aircraft.json` - registration-specific empty mass, CG, and upholstery
  data used to build the registration dropdown.
- `data/fuel-types.json` - approved fuel grade labels and densities used to
  build the fuel type dropdown.
- `data/loading.json` - loading defaults, seat arm options, baggage arm, and
  fuel arm.
- `data/performance.json` - digitised AFM performance tables, wind correction
  factors, surface factors, CG envelope, and aircraft limits.
- `data/runways.json` - runway presets used by the app.
- `data/weather-minima.json` - editable OM-C VFR/IFR weather minima used by
  the METAR/TAF cross-checks.

## Project Structure

- `index.html` - page markup and app shell.
- `css/main.css` - visual styling.
- `js/app.js` - application logic, calculations, charts, local storage, weather
  parsing, and PDF export.
- `favicon.svg` - app favicon and header logo.
- `weather/` - local weather-related support files, if present.

## Running Locally

The project intentionally has no build step. Serve the repository with any
static file server, or use a GitHub Pages deployment. Keep paths relative, such
as `./css/main.css`, `./js/app.js`, and `./data/*.json`, so it works from a
GitHub Pages project URL.

The METAR/TAF fetch buttons read current station text from NOAA/NWS. Because
GitHub Pages runs in the browser and NOAA's text endpoint may not send suitable
CORS headers, the app falls back to public CORS proxies when direct requests are
blocked.

## Development Notes

- Keep aviation data changes in JSON where possible rather than hard-coding
  values into UI logic.
- When changing calculation methods, update both `js/app.js` and this README so
  the documented method stays aligned with the implementation.
- Run a quick syntax check after JavaScript edits:

```powershell
node --check js/app.js
```
