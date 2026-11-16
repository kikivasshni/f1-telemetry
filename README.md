# Pit Wall

Every car, every lap, every metre. Pit Wall rebuilds a Grand Prix from open timing data: the whole field on a 3D circuit, any two laps compared metre for metre, and an engineer that tells you where the time went.

**Live site: https://kikivasshni.github.io/f1-telemetry/**

It is a fully static site. A pipeline pulls each race once, shapes it into compact files, and commits them to this repository. The app reads those files and never calls an API while you are using it.

## What is on the wall

| | |
| --- | --- |
| **Replay** | The whole field on a 3D circuit with real elevation. Scrub through the race, follow a car, or ride behind it, with a live timing tower, race control feed and weather. |
| **Telemetry** | Two laps laid over each other by distance: speed, throttle, brake, gear, and the running time gap between them. |
| **Engineer** | Corner by corner, where the lap time goes and what to do about it, with the lines both cars drove. |
| **Report** | The story of the race written from the timing data, with the lap chart, race trace and every stint. |
| **Predictor** | Gradient-boosted trees call the finishing order from the grid. The model is retrained before every round on earlier races only, then marked against what happened and against the starting grid as a baseline. |
| **Stats desk** | Ask a plain-English question about any season since 1950. The answer is computed in the browser and shown with the query that produced it. |

## Run it locally

Built and tested with Node 22.

```sh
npm ci
npm run dev
```

Then open the address Vite prints. The data for the 2026 season is already in `public/data`, so no pipeline run is needed to look around.

```sh
npm run build     # type-check and build into dist/
npm run preview   # serve the production build
```

## How it works

```
OpenF1, Jolpica  ->  pipeline/  ->  public/data/  ->  browser
   (APIs)          (Node scripts)   (static files)    (React, three.js)
```

**Pipeline** (`pipeline/`). Plain Node scripts with no dependencies.

- `run.mjs` finds every finished race of a season that is not in the lake yet and ingests it. For each session, `ingest-session.mjs` builds a track model with elevation, resamples every car's position onto a 4 Hz grid, delta-encodes it to int16 and gzips it, and writes per-driver telemetry at its native rate.
- `history.mjs` pulls every race result since 1950 into one column-oriented file.
- `predict.mjs` trains the predictor walk-forward over the season and writes its calls and scores.
- `lib/http.mjs` is the client they share. The upstream APIs are rate limited, so it spaces requests per host, retries with backoff, and caches raw responses in `.cache/` so an interrupted run resumes where it stopped.

**Data lake** (`public/data/`). About 68 MB for 20 races.

| File | Contents |
| --- | --- |
| `index.json` | The season calendar and a summary of each race. The app boots from this. |
| `manifest.json` | Size of the lake and figures from the last pipeline run. |
| `sessions/<key>/meta.json` | Drivers, track model, laps, stints, pit stops, race control, weather, classification. |
| `sessions/<key>/timing.json` | Position changes and gap series per driver. |
| `sessions/<key>/report.json` | The written race report. |
| `sessions/<key>/pos.bin.gz` | Every car's x/y at 4 Hz. |
| `sessions/<key>/tel/<driver>.bin.gz` | One driver's speed, rpm, gear, throttle, brake and DRS. |
| `history.json` | Every race result since 1950. |
| `predictor.json` | The predictor's calls and how they scored. |

**App** (`src/`). React 19, TypeScript, Vite, three.js for the 3D scene, canvas and SVG for the charts. It inflates the binary streams in the browser, interpolates car positions between samples, and runs the stats queries locally.

## Refresh the data

```sh
npm run ingest -- --year 2026            # every finished race not in the lake yet
npm run ingest -- --year 2026 --limit 2  # only the next two missing races
npm run ingest -- --session 11412        # re-ingest one session
npm run history                          # results since 1950
npm run predict                          # retrain and re-score the predictor
```

A first full-season ingest is slow because of the upstream rate limits: 20 races is about 1,100 throttled requests. Later runs only fetch what is new.

Where the source has gaps in a race's position data, the replay says so on screen. Timing, telemetry and the report are unaffected.

## Deploy

The site is published to GitHub Pages by two workflows in `.github/workflows/`:

- `deploy.yml` builds and publishes on every push to `main`.
- `ingest.yml` runs every Monday at 06:00 UTC, ingests any race that has finished, refreshes the history and the predictor, commits the new files and redeploys.

One-time setup: in the repository settings, under **Pages**, set **Source** to **GitHub Actions**.

The site is served from `/f1-telemetry/`. To serve it from another path, set `PITWALL_BASE` when building, for example `PITWALL_BASE=/ npm run build`.

## Data and credits

- Car positions, telemetry and timing from [OpenF1](https://openf1.org), licensed CC BY-NC-SA 4.0.
- Results history from [Jolpica F1](https://github.com/jolpica/jolpica-f1), licensed Apache-2.0.
- Circuit maps from MultiViewer.

This project is non-commercial. It is unofficial and not associated in any way with the Formula 1 companies. F1, FORMULA 1 and GRAND PRIX are trade marks of Formula One Licensing B.V.
