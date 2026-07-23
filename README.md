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

### Weather helpers

The Weather tab links to the official EMY/HNMS aviation chart page and the UK
Met Office surface pressure analysis and forecast charts for wider synoptic
context.

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

The scheduled `update-weather.yml` GitHub Actions workflow downloads METAR and
TAF reports from the documented NOAA/NWS AviationWeather `/api/data/metar` and
`/api/data/taf` endpoints every hour and half-hour. It force-publishes only
`data/weather.json` to a dedicated `weather-data` branch, preserving an existing
product when its update times out or returns no report. Keeping these automated
commits off the Pages source branch prevents each weather refresh from triggering
a new site deployment.

On GitHub Pages, the browser reads the `weather-data` branch snapshot through
`raw.githubusercontent.com`, then falls back to the bundled snapshot and existing
live requests if necessary. When AviationWeather returns multiple reports for a
station, the updater selects the report with the newest TAC timestamp rather than
relying on response order. The browser reloads the snapshot every five minutes so
an open page picks up later workflow updates.

Successful browser reads are cached for five minutes. Each product normally has
one Fetch button. Only if both the repository snapshot and live browser fallback
fail does that button change to Paste, allowing a raw report from a trusted
briefing source to be imported without needing a hosted backend. After a pasted
or fetched report is applied, the button changes back to Fetch. Scheduled
workflows can be delayed under GitHub load, so always review the displayed METAR
age and TAF validity before use.

The app also removes legacy standalone Paste controls during startup. The script
URL in `index.html` is versioned when this interaction changes so GitHub Pages
clients do not continue running a cached pre-toggle implementation.

### Reliable free weather scheduling

GitHub documents scheduled workflows as best-effort: runs can be delayed during
high load and some queued jobs can be dropped. Changing the minute in the cron
expression can reduce contention, but cannot make a GitHub-hosted schedule
reliable. The recommended free setup is therefore to keep the existing schedule
as a fallback and have [cron-job.org](https://cron-job.org/) call this workflow's
[`workflow_dispatch` endpoint](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
at minutes 28 and 58. In the cron-job.org job form, enter each part in its own
field—do not paste the whole HTTP example into **Request body**:

- **URL:**
  `https://api.github.com/repos/luke11brown/LXR-Perf-Tool/actions/workflows/update-weather.yml/dispatches`
- **Request method:** `POST`
- **Request body:** `{"ref":"main","inputs":{"source":"cron-job.org"}}`
- **Headers:** add the following four key/value rows:

  | Key | Value |
  | --- | --- |
  | `Authorization` | `Bearer YOUR_FINE_GRAINED_TOKEN` |
  | `Accept` | `application/vnd.github+json` |
  | `X-GitHub-Api-Version` | `2022-11-28` |
  | `Content-Type` | `application/json` |

The token goes in the **Value** column of the `Authorization` row, after the
word `Bearer` and one space. For example, if GitHub displays a token beginning
with `github_pat_`, the row is `Authorization` / `Bearer github_pat_...`. The
request body must contain only the one-line JSON value above—no URL, header
lines, or `POST` prefix.

Create a fine-grained token restricted to this repository with only **Actions:
Read and write**, store it in cron-job.org's `Authorization` header value, and
replace `main` if the repository's default branch has another name. Configure
retries for non-2xx responses. A successful dispatch returns HTTP 204; the
workflow run name then identifies `cron-job.org` as its source. Do not put the
token in this repository, a query string, or the request body.

This approach remains free for the current public-repository workflow, uses the
same tested updater and publishing path, and avoids depending on GitHub's cron
queue for the primary trigger. It does not make aviation weather authoritative:
continue to check the displayed report age and verify operational weather from
an approved source.

## Development Notes

- Keep aviation data changes in JSON where possible rather than hard-coding
  values into UI logic.
- When changing calculation methods, update both `js/app.js` and this README so
  the documented method stays aligned with the implementation.
- Run a quick syntax check after JavaScript edits:

```powershell
node --check js/app.js
```
