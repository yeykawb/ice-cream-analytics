/**
 * db.js — DuckDB WASM initialisation and query runner.
 *
 * Mirrors a medallion architecture in SQL:
 *   stg_*  → raw JSON loaded as tables
 *   int_*  → derived metrics (fat%, PAC, POD, FPD)
 *   fct_*  → joined fact table ready for the dashboard
 *   agg_*  → recipe-level aggregations
 */

let _db = null;
let _conn = null;

export async function initDB() {
    if (_conn) return _conn;

    // Load DuckDB WASM via jsDelivr CDN
    const duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser.mjs');

    const BUNDLES = duckdb.getJsDelivrBundles();
    const bundle  = await duckdb.selectBundle(BUNDLES);

    const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );

    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    _db = new duckdb.AsyncDuckDB(logger, worker);
    await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    _conn = await _db.connect();

    await _loadData();
    await _buildViews();

    return _conn;
}

async function _loadData() {
    const base = _resolveBase();

    // Fetch all four JSON files as text
    const [ingredients, batches, batchIngredients, evaluations] = await Promise.all([
        fetch(`${base}/data/ingredients_ref.json`).then(r => r.text()),
        fetch(`${base}/data/batches.json`).then(r => r.text()),
        fetch(`${base}/data/batch_ingredients.json`).then(r => r.text()),
        fetch(`${base}/data/evaluations.json`).then(r => r.text()),
    ]);

    // Register as virtual files in DuckDB's in-memory filesystem
    await _db.registerFileText('ingredients_ref.json', ingredients);
    await _db.registerFileText('batches.json', batches);
    await _db.registerFileText('batch_ingredients.json', batchIngredients);
    await _db.registerFileText('evaluations.json', evaluations);

    await _conn.query(`CREATE TABLE ingredients_ref AS SELECT * FROM read_json_auto('ingredients_ref.json');`);
    await _conn.query(`CREATE TABLE batches AS SELECT * FROM read_json_auto('batches.json');`);
    await _conn.query(`CREATE TABLE batch_ingredients AS SELECT * FROM read_json_auto('batch_ingredients.json');`);
    await _conn.query(`CREATE TABLE evaluations AS SELECT * FROM read_json_auto('evaluations.json');`);
}

async function _buildViews() {
    // stg: ingredient amounts joined with reference data
    await _conn.query(`
        CREATE VIEW stg_ingredients AS
        SELECT
            bi.batch_id,
            bi.ingredient_id,
            bi.amount_g,
            ir.name            AS ingredient_name,
            ir.fat_pct,
            ir.msnf_pct,
            ir.sugar_pct,
            ir.water_pct,
            ir.pac_coeff,
            ir.pod_coeff,
            bi.amount_g * ir.fat_pct   / 100 AS fat_g,
            bi.amount_g * ir.msnf_pct  / 100 AS msnf_g,
            bi.amount_g * ir.sugar_pct / 100 AS sugar_g,
            bi.amount_g * ir.water_pct / 100 AS water_g,
            bi.amount_g * ir.pac_coeff        AS pac_contrib,
            bi.amount_g * ir.pod_coeff        AS pod_contrib
        FROM batch_ingredients bi
        JOIN ingredients_ref   ir ON bi.ingredient_id = ir.id;
    `);

    // int: derived metrics per batch
    await _conn.query(`
        CREATE VIEW int_batch_metrics AS
        SELECT
            batch_id,
            ROUND(SUM(amount_g), 0)                              AS total_g,
            ROUND(SUM(fat_g)   / SUM(amount_g) * 100, 1)        AS fat_pct,
            ROUND(SUM(msnf_g)  / SUM(amount_g) * 100, 1)        AS msnf_pct,
            ROUND(SUM(sugar_g) / SUM(amount_g) * 100, 1)        AS sugar_pct,
            ROUND(SUM(water_g) / SUM(amount_g) * 100, 1)        AS water_pct,
            ROUND(SUM(pac_contrib) / SUM(amount_g) * 100, 2)    AS pac_pct,
            ROUND(SUM(pod_contrib) / SUM(amount_g) * 100, 2)    AS pod_pct,
            ROUND(SUM(pac_contrib) / SUM(amount_g) * 3.7, 2)    AS fpd_c
        FROM stg_ingredients
        GROUP BY batch_id;
    `);

    // fct: one row per batch with all attributes + scores
    await _conn.query(`
        CREATE VIEW fct_batches AS
        SELECT
            b.id,
            b.date,
            b.recipe,
            b.recipe_label,
            b.version,
            b.yield_g,
            b.churn_min,
            b.serve_temp_c,
            m.fat_pct,
            m.msnf_pct,
            m.sugar_pct,
            m.water_pct,
            m.pac_pct,
            m.pod_pct,
            m.fpd_c,
            e.texture_score,
            e.flavour_score,
            e.appearance_score,
            e.iciness_notes,
            e.body_notes,
            e.overall_notes,
            ROUND((e.texture_score + e.flavour_score + e.appearance_score) / 3.0, 1) AS avg_score
        FROM batches            b
        JOIN int_batch_metrics  m ON b.id = m.batch_id
        LEFT JOIN evaluations   e ON b.id = e.batch_id
        ORDER BY b.date DESC;
    `);

    // agg: per-recipe summary
    await _conn.query(`
        CREATE VIEW agg_recipes AS
        SELECT
            recipe,
            recipe_label,
            COUNT(*)                               AS batch_count,
            ROUND(AVG(avg_score), 1)               AS avg_score,
            MAX(avg_score)                         AS best_score,
            ROUND(AVG(fat_pct), 1)                 AS avg_fat_pct,
            ROUND(AVG(pac_pct), 2)                 AS avg_pac_pct,
            ROUND(AVG(pod_pct), 2)                 AS avg_pod_pct
        FROM fct_batches
        GROUP BY recipe, recipe_label
        ORDER BY avg_score DESC;
    `);
}

export async function query(sql) {
    const conn   = await initDB();
    const result = await conn.query(sql);
    return result.toArray().map(r => {
        const obj = r.toJSON();
        // Arrow v17 returns Int64 columns as BigInt; convert to Number for Chart.js
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])
        );
    });
}

// ── Helpers ────────────────────────────────────────────

function _resolveBase() {
    // Works from both /index.html and /journal/index.html
    const path = window.location.pathname;
    if (path.includes('/journal')) {
        return window.location.origin + path.replace(/\/journal\/.*$/, '');
    }
    return window.location.origin + path.replace(/\/[^/]*$/, '');
}
