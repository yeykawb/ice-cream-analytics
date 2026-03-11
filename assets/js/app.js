/**
 * app.js — Dashboard entry point.
 * Loads DuckDB, runs queries, renders stats + charts.
 */

import { initDB, query } from './db.js';
import { renderRadar, renderScatter, renderTimeline } from './charts.js';

(async () => {
    document.getElementById('dashboard-loading').style.display = 'flex';
    document.getElementById('dashboard-content').style.display = 'none';

    try {
        await initDB();
        const batches = await query('SELECT * FROM fct_batches ORDER BY date DESC');

        document.getElementById('dashboard-loading').style.display = 'none';
        document.getElementById('dashboard-content').style.display = 'block';

        renderStats(batches);
        renderBatchSelector(batches, batches[0]);
        renderCharts(batches, batches[0]);
    } catch (err) {
        document.getElementById('dashboard-loading').innerHTML =
            `<p style="color:#ff453a">Failed to initialise: ${err.message}</p>`;
        console.error(err);
    }
})();

// ── Stats row ──────────────────────────────────────────

function renderStats(batches) {
    const total    = batches.length;
    const avgScore = (batches.reduce((s, b) => s + b.avg_score, 0) / total).toFixed(1);
    const best     = batches.slice().sort((a, b) => b.avg_score - a.avg_score)[0];
    const recipes  = new Set(batches.map(b => b.recipe)).size;

    document.getElementById('stat-batches').textContent  = total;
    document.getElementById('stat-avg').textContent      = avgScore;
    document.getElementById('stat-best').textContent     = best.avg_score;
    document.getElementById('stat-best-sub').textContent = `${best.recipe_label} v${best.version}`;
    document.getElementById('stat-recipes').textContent  = recipes;
}

// ── Batch selector (flat scrollable list) ─────────────

function renderBatchSelector(batches, active) {
    const wrap = document.getElementById('batch-selector');
    wrap.innerHTML = '';

    batches.forEach(b => {
        const scoreColor = b.avg_score >= 4.5 ? '#30d158' : b.avg_score >= 3 ? '#ff9500' : '#ff453a';
        const item = document.createElement('button');
        item.className = 'batch-list-item' + (b.id === active.id ? ' active' : '');
        item.innerHTML = `
            <span class="batch-item-id">${b.id}</span>
            <span class="batch-item-name">${b.recipe_label} <span class="batch-item-version">v${b.version}</span></span>
            <span class="batch-item-date">${fmtDate(b.date)}</span>
            <span class="batch-item-score" style="color:${scoreColor}">${b.avg_score}</span>
        `;
        item.addEventListener('click', () => {
            wrap.querySelectorAll('.batch-list-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            renderBatchDetail(b);
        });
        wrap.appendChild(item);
    });
}

function fmtDate(d) {
    return new Date(d).toLocaleDateString('en-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Batch detail panel ─────────────────────────────────

function renderBatchDetail(batch) {
    renderRadar('radar-chart', batch);
    renderMetrics(batch);
}

function renderMetrics(batch) {
    const rows = [
        { label: 'Fat',        value: `${batch.fat_pct}%`,   bar: batch.fat_pct / 18 },
        { label: 'MSNF',       value: `${batch.msnf_pct}%`,  bar: batch.msnf_pct / 12 },
        { label: 'Water',      value: `${batch.water_pct}%`, bar: batch.water_pct / 70 },
        { label: 'PAC',        value: `${batch.pac_pct}%`,   bar: batch.pac_pct / 25 },
        { label: 'POD',        value: `${batch.pod_pct}%`,   bar: batch.pod_pct / 20 },
        { label: 'FPD (est.)', value: `−${batch.fpd_c}°C`,   bar: batch.fpd_c / 5 },
    ];

    document.getElementById('metrics-panel').innerHTML = rows.map(r => `
        <div class="metric-row">
            <div>
                <div class="metric-name">${r.label}</div>
                <div class="metric-bar-wrap">
                    <div class="metric-bar" style="width:${Math.min(100, r.bar * 100).toFixed(1)}%"></div>
                </div>
            </div>
            <div class="metric-val">${r.value}</div>
        </div>
    `).join('');

    const tagPills = batch.tags
        ? batch.tags.split(', ').map(t => `<span class="tag-pill">${t}</span>`).join('')
        : '';

    document.getElementById('batch-info').innerHTML = `
        <div class="metric-row">
            <span class="metric-name">Date</span>
            <span class="metric-val">${fmtDate(batch.date)}</span>
        </div>
        ${tagPills ? `<div class="tag-pills-row">${tagPills}</div>` : ''}
    `;
}

// ── Bottom charts ──────────────────────────────────────

function renderCharts(batches, activeBatch) {
    renderRadar('radar-chart', activeBatch);
    renderMetrics(activeBatch);
    renderScatter('scatter-chart', batches);
    renderTimeline('timeline-chart', batches);
}
