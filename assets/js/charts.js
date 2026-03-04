/**
 * charts.js — Chart.js rendering helpers.
 * All charts share the dark-mode palette defined in style.css.
 */

const ACCENT  = '#ff9500';
const GREEN   = '#30d158';
const BLUE    = '#0a84ff';
const MUTED   = '#555555';
const TEXT    = '#f0f0f0';
const GRID    = 'rgba(255,255,255,0.06)';

Chart.defaults.color          = TEXT;
Chart.defaults.borderColor    = GRID;
Chart.defaults.font.family    = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
Chart.defaults.font.size      = 12;

// ── Radar: per-batch sensory + metrics ─────────────────

export function renderRadar(canvasId, batch) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Destroy previous instance if any
    if (ctx._chart) ctx._chart.destroy();

    // Normalise metrics to 0-5 scale for display alongside scores
    const pac  = Math.min(5, (batch.pac_pct  / 25) * 5);   // 25% PAC = max
    const pod  = Math.min(5, (batch.pod_pct  / 20) * 5);   // 20% POD = max
    const fat  = Math.min(5, (batch.fat_pct  / 18) * 5);   // 18% fat = max

    ctx._chart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Texture', 'Flavour', 'Appearance', 'Fat', 'PAC', 'POD'],
            datasets: [{
                label: `${batch.recipe_label} v${batch.version}`,
                data: [
                    batch.texture_score,
                    batch.flavour_score,
                    batch.appearance_score,
                    fat,
                    pac,
                    pod,
                ],
                borderColor:           ACCENT,
                backgroundColor:       'rgba(255,149,0,0.12)',
                pointBackgroundColor:  ACCENT,
                pointBorderColor:      ACCENT,
                pointRadius:           4,
                borderWidth:           2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                r: {
                    min: 0,
                    max: 5,
                    ticks: {
                        stepSize: 1,
                        display: false,
                    },
                    grid:        { color: GRID },
                    angleLines:  { color: GRID },
                    pointLabels: { font: { size: 12 }, color: TEXT },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const label = ctx.label;
                            const val   = ctx.raw;
                            // Show raw values for sensory, computed for metrics
                            if (['Texture','Flavour','Appearance'].includes(label)) {
                                return ` ${val} / 5`;
                            }
                            if (label === 'Fat')        return ` ${batch.fat_pct}%`;
                            if (label === 'PAC')        return ` ${batch.pac_pct}%`;
                            if (label === 'POD')        return ` ${batch.pod_pct}%`;
                            return ` ${val}`;
                        },
                    },
                },
            },
        },
    });
}

// ── Scatter: PAC% vs texture score ────────────────────

export function renderScatter(canvasId, batches) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (ctx._chart) ctx._chart.destroy();

    const points = batches.map(b => ({
        x: b.pac_pct,
        y: b.texture_score,
        label: `${b.recipe_label} v${b.version}`,
    }));

    ctx._chart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'PAC% vs Texture',
                data:            points,
                backgroundColor: ACCENT,
                borderColor:     ACCENT,
                pointRadius:     7,
                pointHoverRadius:9,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'PAC %', color: TEXT },
                    grid:  { color: GRID },
                    ticks: { color: TEXT },
                },
                y: {
                    min: 0,
                    max: 5,
                    title: { display: true, text: 'Texture Score', color: TEXT },
                    grid:  { color: GRID },
                    ticks: { color: TEXT, stepSize: 1 },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.raw.label}: PAC ${ctx.raw.x}%, Texture ${ctx.raw.y}`,
                    },
                },
            },
        },
    });
}

// ── Line: recipe version score timeline ───────────────

export function renderTimeline(canvasId, batches) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (ctx._chart) ctx._chart.destroy();

    // Group by recipe, sort by version
    const byRecipe = {};
    batches.forEach(b => {
        if (!byRecipe[b.recipe]) byRecipe[b.recipe] = [];
        byRecipe[b.recipe].push(b);
    });

    const palette = [ACCENT, GREEN, BLUE, '#af52de', '#ff6b6b'];
    const datasets = Object.entries(byRecipe).map(([recipe, rows], i) => {
        rows.sort((a, b) => a.version - b.version);
        return {
            label:           rows[0].recipe_label,
            data:            rows.map(r => ({ x: r.version, y: r.avg_score, date: r.date })),
            borderColor:     palette[i % palette.length],
            backgroundColor: palette[i % palette.length],
            pointRadius:     5,
            pointHoverRadius:7,
            tension:         0.3,
            fill:            false,
        };
    });

    // Collect all versions for x-axis
    const allVersions = [...new Set(batches.map(b => b.version))].sort((a,b) => a-b);

    ctx._chart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type:  'linear',
                    title: { display: true, text: 'Version', color: TEXT },
                    ticks: { color: TEXT, stepSize: 1 },
                    grid:  { color: GRID },
                    min:   0.5,
                    max:   Math.max(...allVersions) + 0.5,
                },
                y: {
                    min:   0,
                    max:   5,
                    title: { display: true, text: 'Avg Score', color: TEXT },
                    ticks: { color: TEXT, stepSize: 1 },
                    grid:  { color: GRID },
                },
            },
            plugins: {
                legend: {
                    display:  true,
                    position: 'bottom',
                    labels:   { color: TEXT, boxWidth: 12, padding: 16 },
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label} — Avg ${ctx.raw.y} (${ctx.raw.date})`,
                    },
                },
            },
        },
    });
}
