/**
 * journal.js — Batch journal rendering.
 * Reverse-chronological log of all batches with metrics + notes.
 */

import { initDB, query } from './db.js';

(async () => {
    const list    = document.getElementById('journal-list');
    const loading = document.getElementById('journal-loading');

    try {
        await initDB();
        const batches = await query('SELECT * FROM fct_batches ORDER BY date DESC');

        loading.style.display = 'none';

        batches.forEach(b => {
            const avgScore   = b.avg_score;
            const scoreColor = avgScore >= 4.5 ? '#30d158' : avgScore >= 3 ? '#ff9500' : '#ff453a';

            const tagPills = b.tags
                ? b.tags.split(', ').map(t => `<span class="tag-pill">${t}</span>`).join('')
                : '';

            const entry = document.createElement('article');
            entry.className = 'journal-entry';
            entry.innerHTML = `
                <div class="journal-entry-header">
                    <div class="journal-entry-meta">
                        <h2>${b.recipe_label} <span style="color:var(--text-muted);font-weight:400">v${b.version}</span></h2>
                        <div class="date">${formatDate(b.date)} &nbsp;·&nbsp; Batch ${b.id}</div>
                        ${tagPills ? `<div class="tag-pills-row" style="margin-top:8px">${tagPills}</div>` : ''}
                    </div>
                    <div class="journal-scores">
                        <div class="journal-score-item">
                            <div class="score-label">Texture</div>
                            <div class="score-num">${b.texture_score}</div>
                        </div>
                        <div class="journal-score-item">
                            <div class="score-label">Flavour</div>
                            <div class="score-num">${b.flavour_score}</div>
                        </div>
                        <div class="journal-score-item">
                            <div class="score-label">Appearance</div>
                            <div class="score-num">${b.appearance_score}</div>
                        </div>
                        <div class="journal-score-item">
                            <div class="score-label">Avg</div>
                            <div class="score-num" style="color:${scoreColor}">${avgScore}</div>
                        </div>
                    </div>
                </div>

                <div class="journal-metrics-row">
                    ${pill('Fat',   b.fat_pct  + '%')}
                    ${pill('MSNF',  b.msnf_pct + '%')}
                    ${pill('Water', b.water_pct + '%')}
                    ${pill('PAC',   b.pac_pct   + '%')}
                    ${pill('POD',   b.pod_pct   + '%')}
                    ${pill('FPD',   '−' + b.fpd_c + '°C')}
                </div>

                <div class="journal-notes">
                    ${note('Info', b.batch_info)}
                    ${note('Notes', b.notes)}
                </div>
            `;

            list.appendChild(entry);
        });

    } catch (err) {
        loading.innerHTML = `<p style="color:#ff453a">Failed to load journal: ${err.message}</p>`;
        console.error(err);
    }
})();

function pill(label, value) {
    return `<span class="journal-metric-pill">${label} <strong>${value}</strong></span>`;
}

function note(label, text) {
    if (!text) return '';
    return `
        <div>
            <div class="journal-note-label">${label}</div>
            <div class="journal-note">${text.replace(/\n/g, '<br>')}</div>
        </div>
    `;
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-SE', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
}
