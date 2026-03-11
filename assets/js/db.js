/**
 * db.js — DuckDB WASM initialisation and query runner.
 *
 * Data source: .rcx files (IceCreamCalc XML exports) in data/rcx/.
 * Discovered automatically via the directory listing served by Python's http.server.
 *
 * Mirrors a medallion architecture in SQL:
 *   stg_ingredients  → TABLE built from parsed RCX data
 *   int_batch_metrics → derived metrics (fat%, PAC, POD, FPD)
 *   fct_batches       → joined fact table ready for the dashboard
 *   agg_recipes       → recipe-level aggregations
 */

import { parseRCX } from './rcx.js';

let _db   = null;
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

    // Discover .rcx files via directory listing (Python http.server returns HTML)
    const dirHtml = await fetch(`${base}/data/rcx/`).then(r => r.text());
    const dirDoc  = new DOMParser().parseFromString(dirHtml, 'text/html');
    const rcxFiles = [...dirDoc.querySelectorAll('a[href]')]
        .map(a => a.getAttribute('href'))
        .filter(href => /\.rcx$/i.test(href))
        .map(href => href.split('/').pop()); // strip any leading path

    // Sort by numeric B-prefix (B001 < B002 < B1000)
    rcxFiles.sort((a, b) => {
        const na = parseInt((a.match(/^B(\d+)/i) || [, '0'])[1]);
        const nb = parseInt((b.match(/^B(\d+)/i) || [, '0'])[1]);
        return na - nb;
    });

    if (rcxFiles.length === 0) {
        throw new Error('No .rcx files found in data/rcx/. Add at least one batch file.');
    }

    // Fetch and parse all RCX files in parallel
    const parsed = await Promise.all(rcxFiles.map(async filename => {
        const batchId = (filename.match(/^(B\d+)/i) || ['', filename])[1].toUpperCase();
        const xmlText = await fetch(`${base}/data/rcx/${filename}`).then(r => r.text());
        return parseRCX(batchId, xmlText);
    }));

    const batches     = parsed.map(p => p.batch);
    const evaluations = parsed.map(p => p.evaluation);
    const stgRows     = parsed.flatMap(p => p.ingredientRows);

    // Register as virtual files in DuckDB's in-memory filesystem
    await _db.registerFileText('batches.json',         JSON.stringify(batches));
    await _db.registerFileText('evaluations.json',     JSON.stringify(evaluations));
    await _db.registerFileText('stg_ingredients.json', JSON.stringify(stgRows));

    await _conn.query(`CREATE TABLE batches         AS SELECT * FROM read_json_auto('batches.json');`);
    await _conn.query(`CREATE TABLE evaluations     AS SELECT * FROM read_json_auto('evaluations.json');`);
    await _conn.query(`CREATE TABLE stg_ingredients AS SELECT * FROM read_json_auto('stg_ingredients.json');`);
}

async function _buildViews() {
    // stg_ingredients is now a TABLE (built in _loadData) — start from int_batch_metrics

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

    await _conn.query(`
        CREATE VIEW fct_batches AS
        SELECT
            b.id,
            b.date,
            b.recipe,
            b.recipe_label,
            b.version,
            b.tags,
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
            e.batch_info,
            e.notes,
            ROUND(
                (COALESCE(e.texture_score, 0) + COALESCE(e.flavour_score, 0) + COALESCE(e.appearance_score, 0))
                / NULLIF(
                    (e.texture_score IS NOT NULL)::INT +
                    (e.flavour_score IS NOT NULL)::INT +
                    (e.appearance_score IS NOT NULL)::INT, 0)
            , 1) AS avg_score
        FROM batches            b
        JOIN int_batch_metrics  m ON b.id = m.batch_id
        LEFT JOIN evaluations   e ON b.id = e.batch_id
        ORDER BY b.date DESC;
    `);

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
            Object.entries(obj).map(([k, v]) => {
                if (typeof v === 'bigint') return [k, Number(v)];
                if (v === 'null' || v === 'undefined') return [k, null];
                return [k, v];
            })
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
