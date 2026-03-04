# Ice Cream Analytics — Jakob Agelin

Personal data platform for ice cream experimentation. Batch records flow through DuckDB WASM SQL views (mirroring a medallion architecture) into a scored sensory dashboard and batch journal.

## Project

Fully static site — no build tool, no framework, no package manager. Runs entirely in the browser via DuckDB WASM. Deployable on GitHub Pages.

## File Structure

```
index.html              # Dashboard (stats, radar, scatter, timeline)
journal/
  index.html            # Batch journal (reverse-chron, full notes)
data/
  ingredients_ref.json  # Ingredient reference: fat%, MSNF%, PAC coeff, POD coeff
  batches.json          # Batch metadata: date, recipe, version, yield, churn time
  batch_ingredients.json# Flat: one row per ingredient per batch
  evaluations.json      # Sensory scores + notes per batch
assets/
  css/style.css         # All styles — dark mode default, orange (#ff9500) accent
  js/db.js              # DuckDB WASM init, data loading, SQL views
  js/charts.js          # Chart.js rendering (radar, scatter, line timeline)
  js/app.js             # Dashboard logic (stats, batch selector, metric panels)
  js/journal.js         # Journal rendering
```

## Data Model (SQL layer in db.js)

Four views built on top of the four JSON tables, mirroring a medallion architecture:

| View | Layer | Description |
|------|-------|-------------|
| `stg_ingredients` | Staging | batch_ingredients joined to ingredients_ref; computes fat_g, water_g, pac_contrib, pod_contrib per ingredient row |
| `int_batch_metrics` | Intermediate | Aggregates stg_ingredients per batch → fat%, MSNF%, water%, PAC%, POD%, FPD estimate |
| `fct_batches` | Fact | Joins batches + int_batch_metrics + evaluations → one complete row per batch |
| `agg_recipes` | Aggregate | Per-recipe averages: avg/best score, avg fat/PAC/POD |

## Ice Cream Science Metrics

| Metric | Meaning | Typical target |
|--------|---------|---------------|
| **PAC** | Anti-crystallisation power (relative to sucrose = 1.0). Higher = lower freezing point, finer crystals. | 17–22% of mix |
| **POD** | Sweetness relative to sucrose (sucrose = 1.0). | 14–18% of mix |
| **FPD** | Freezing Point Depression estimate (°C). Derived: PAC_pct × 3.7 / 100. | −2.5 to −3.5°C |
| **Fat%** | Total fat as % of mix weight. | 8–14% (gelato), up to 18% (ice cream) |
| **MSNF%** | Milk Solids Non-Fat. Contributes body and texture. | 8–12% |
| **Water%** | Free water available to freeze. | 55–65% |

## Conventions

- Indentation: 4 spaces
- Dark mode is the default (CSS variables on `:root`, no class toggle needed)
- All JS uses ES modules (`type="module"`) — no bundler
- `db.js` exports `initDB()` and `query(sql)` — all other modules import from it
- Chart.js 4.4.0 from jsDelivr CDN (loaded as a regular script in HTML, available globally)
- DuckDB WASM 1.29.0 from jsDelivr CDN (dynamically imported inside db.js)
- No other external dependencies

## Local Development

Must be served over HTTP — `file://` won't work due to WASM/CORS restrictions.

```bash
python -m http.server 8080
# or
npx serve .
```

Open `http://localhost:8080`

## Deployment

GitHub Pages — push to `main`, enable Pages from repo settings. `.nojekyll` is present.

## Adding a New Batch

1. Add a row to `data/batches.json` (new `id`, `date`, `recipe`, `version`, etc.)
2. Add ingredient rows to `data/batch_ingredients.json` (reference `ingredients_ref.json` for valid `ingredient_id` values)
3. Add a row to `data/evaluations.json` with `texture_score`, `flavour_score`, `appearance_score`, and notes
4. No code changes needed — the SQL views and charts rebuild automatically from the data

## Adding a New Ingredient

Add a row to `data/ingredients_ref.json` with:
- `id` — snake_case identifier used in `batch_ingredients.json`
- `fat_pct`, `msnf_pct`, `sugar_pct`, `water_pct` — compositional percentages
- `pac_coeff` — PAC contribution per gram of ingredient (sucrose = 1.0)
- `pod_coeff` — sweetness contribution per gram of ingredient (sucrose = 1.0)

## Do Not

- Add build steps, package.json, or bundlers
- Add JS or CSS frameworks (no React, Vue, Bootstrap, Tailwind)
- Add external dependencies beyond Chart.js and DuckDB WASM
- Open via `file://` for testing — always use a local HTTP server
