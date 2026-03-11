/**
 * journal.js — Batch journal rendering.
 * Entries collapsed by default; filterable by text search and tag.
 */

import { initDB, query } from './db.js';

let _batches    = [];
let _ingMap     = new Map();
let _mediaMap   = new Map();
let _base       = '';
let _searchText = '';
let _activeTags = new Set();

(async () => {
    const list    = document.getElementById('journal-list');
    const loading = document.getElementById('journal-loading');

    try {
        _base = _resolveBase();

        await initDB();
        const [batches, ingRows] = await Promise.all([
            query('SELECT * FROM fct_batches ORDER BY date DESC'),
            query('SELECT batch_id, ingredient_name, amount_g FROM stg_ingredients ORDER BY batch_id, amount_g DESC'),
        ]);

        _batches  = batches;
        _mediaMap = await _loadMedia();

        for (const r of ingRows) {
            if (!_ingMap.has(r.batch_id)) _ingMap.set(r.batch_id, []);
            _ingMap.get(r.batch_id).push(r);
        }

        _initLightbox();
        loading.style.display = 'none';

        const allTags   = [...new Set(batches.flatMap(b => b.tags ? b.tags.split(', ') : []))].sort().filter(Boolean);
        const tagGroups = await _loadTagGroups();

        _buildFilters(allTags, tagGroups, list);
        _renderEntries(list);

    } catch (err) {
        loading.innerHTML = `<p style="color:#ff453a">Failed to load journal: ${err.message}</p>`;
        console.error(err);
    }
})();

// ── Filter bar ──────────────────────────────────────────

async function _loadTagGroups() {
    try {
        const res = await fetch(`${_base}/data/tag-groups.json`);
        if (!res.ok) return [];
        return (await res.json()).groups ?? [];
    } catch { return []; }
}

function _buildFilters(allTags, tagGroups, list) {
    const bar = document.getElementById('journal-filter-bar');
    if (!bar) return;

    // Match group config tags (case-insensitive) against actual tags in data
    const tagMap      = new Map(allTags.map(t => [t.toLowerCase(), t]));
    const assigned    = new Set();
    const groupSects  = tagGroups.map(g => {
        const matched = g.tags.map(t => tagMap.get(t.toLowerCase())).filter(Boolean);
        matched.forEach(t => assigned.add(t));
        return { label: g.label, tags: matched };
    }).filter(g => g.tags.length > 0);

    const ungrouped = allTags.filter(t => !assigned.has(t));

    const btn  = t  => `<button class="filter-tag-btn" data-tag="${t}">${t}</button>`;
    const sect = (label, tags) => `
        <div class="filter-tag-section">
            ${label ? `<span class="filter-group-label">${label}</span>` : ''}
            <div class="filter-tag-group">${tags.map(btn).join('')}</div>
        </div>`;

    bar.innerHTML = `
        <input type="search" class="filter-search" id="filter-search" placeholder="Search recipe or tag…">
        ${groupSects.map(g => sect(g.label, g.tags)).join('')}
        ${ungrouped.length ? sect('', ungrouped) : ''}
        <button class="filter-clear" id="filter-clear" hidden>Clear</button>
    `;

    const searchEl = document.getElementById('filter-search');
    const clearEl  = document.getElementById('filter-clear');

    searchEl.addEventListener('input', e => {
        _searchText = e.target.value.trim().toLowerCase();
        _syncClear(clearEl, searchEl);
        _renderEntries(list);
    });

    bar.querySelectorAll('.filter-tag-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.dataset.tag;
            if (_activeTags.has(tag)) {
                _activeTags.delete(tag);
                btn.classList.remove('active');
            } else {
                _activeTags.add(tag);
                btn.classList.add('active');
            }
            _syncClear(clearEl, searchEl);
            _renderEntries(list);
        });
    });

    clearEl.addEventListener('click', () => {
        _searchText = '';
        _activeTags.clear();
        searchEl.value = '';
        bar.querySelectorAll('.filter-tag-btn').forEach(b => b.classList.remove('active'));
        _syncClear(clearEl, searchEl);
        _renderEntries(list);
    });
}

function _syncClear(btn) {
    btn.hidden = !_searchText && _activeTags.size === 0;
}

// ── Entry rendering ─────────────────────────────────────

function _renderEntries(list) {
    const filtered = _batches.filter(b => {
        if (_searchText) {
            const haystack = [b.recipe_label, b.tags || '', b.id].join(' ').toLowerCase();
            if (!haystack.includes(_searchText)) return false;
        }
        if (_activeTags.size > 0) {
            const bTags = new Set(b.tags ? b.tags.split(', ') : []);
            for (const t of _activeTags) if (!bTags.has(t)) return false;
        }
        return true;
    });

    list.innerHTML = '';

    if (!filtered.length) {
        list.innerHTML = '<p class="journal-empty">No batches match the current filter.</p>';
        return;
    }

    filtered.forEach(b => {
        const avgScore   = b.avg_score;
        const unrated    = avgScore == null;
        const scoreColor = unrated ? 'var(--text-muted)' : avgScore >= 4.5 ? '#30d158' : avgScore >= 3 ? '#ff9500' : '#ff453a';

        const tagPills = b.tags
            ? b.tags.split(', ').map(t => `<span class="tag-pill">${t}</span>`).join('')
            : '';

        const entry = document.createElement('details');
        entry.className = 'journal-entry';
        entry.innerHTML = `
            <summary class="journal-entry-summary">
                <div class="journal-entry-meta">
                    <h2>${b.recipe_label} <span style="color:var(--text-muted);font-weight:400">v${b.version}</span></h2>
                    <div class="date">${formatDate(b.date)} &nbsp;·&nbsp; Batch ${b.id}</div>
                    ${tagPills ? `<div class="tag-pills-row" style="margin-top:8px">${tagPills}</div>` : ''}
                </div>
                <div class="journal-entry-right">
                    <div class="journal-scores">
                        <div class="journal-score-item">
                            <div class="score-label">Texture</div>
                            <div class="score-num">${b.texture_score ?? '—'}</div>
                        </div>
                        <div class="journal-score-item">
                            <div class="score-label">Flavour</div>
                            <div class="score-num">${b.flavour_score ?? '—'}</div>
                        </div>
                        <div class="journal-score-item">
                            <div class="score-label">Appearance</div>
                            <div class="score-num">${b.appearance_score ?? '—'}</div>
                        </div>
                        <div class="journal-score-item">
                            <div class="score-label">Avg</div>
                            <div class="score-num" style="color:${scoreColor}">${avgScore ?? '—'}</div>
                        </div>
                    </div>
                    <span class="journal-chevron">›</span>
                </div>
            </summary>

            <div class="journal-entry-body">
                <div class="journal-metrics-row">
                    ${pill('Fat',   b.fat_pct  + '%')}
                    ${pill('MSNF',  b.msnf_pct + '%')}
                    ${pill('Water', b.water_pct + '%')}
                    ${pill('PAC',   b.pac_pct   + '%')}
                    ${pill('POD',   b.pod_pct   + '%')}
                    ${pill('FPD',   '−' + b.fpd_c + '°C')}
                </div>

                <div class="journal-notes">
                    ${mediaSection(_mediaMap.get(b.id) || [])}
                    ${ingredients(_ingMap.get(b.id) || [])}
                    ${note('Info', b.batch_info)}
                    ${note('Notes', b.notes)}
                </div>
            </div>
        `;

        list.appendChild(entry);
    });
}

// ── Helpers ─────────────────────────────────────────────

function pill(label, value) {
    return `<span class="journal-metric-pill">${label} <strong>${value}</strong></span>`;
}

function ingredients(rows) {
    if (!rows.length) return '';
    const items = rows.map(r => {
        const g = Math.round(r.amount_g * 10) / 10;
        return `<div class="ingredient-row">
            <span class="ingredient-name">${r.ingredient_name}</span>
            <span class="ingredient-amount">${g}g</span>
        </div>`;
    }).join('');
    return `
        <details class="journal-note-block" open>
            <summary class="journal-note-label">Ingredients</summary>
            <div class="ingredient-list">${items}</div>
        </details>
    `;
}

function note(label, text) {
    if (!text) return '';
    const open = text.length <= 280 ? ' open' : '';
    return `
        <details class="journal-note-block"${open}>
            <summary class="journal-note-label">${label}</summary>
            <div class="journal-note">${text.replace(/\n/g, '<br>')}</div>
        </details>
    `;
}

// ── Media ────────────────────────────────────────────

function _resolveBase() {
    const path = window.location.pathname;
    if (path.includes('/journal')) {
        return window.location.origin + path.replace(/\/journal\/.*$/, '');
    }
    return window.location.origin + path.replace(/\/[^/]*$/, '');
}

async function _loadMedia() {
    const pattern = /\.(jpg|jpeg|png|gif|webp|mp4|mov|webm)$/i;
    const files   = await _discoverFiles('data/media', pattern);
    const map     = new Map();
    for (const f of files) {
        const m = f.match(/^(B\d+)/i);
        if (!m) continue;
        const id = m[1].toUpperCase();
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(f);
    }
    return map;
}

async function _discoverFiles(dir, pattern) {
    try {
        const res = await fetch(`${_base}/${dir}/`);
        if (res.ok) {
            const html  = await res.text();
            const doc   = new DOMParser().parseFromString(html, 'text/html');
            const files = [...doc.querySelectorAll('a[href]')]
                .map(a => a.getAttribute('href').split('/').pop())
                .filter(f => pattern.test(f));
            if (files.length > 0) return files;
        }
    } catch { /* fall through */ }

    const apiUrl = _githubContentsUrl(dir);
    if (!apiUrl) return [];
    try {
        const res  = await fetch(apiUrl, { headers: { Accept: 'application/vnd.github.v3+json' } });
        if (!res.ok) return [];
        const items = await res.json();
        return items.filter(f => f.type === 'file' && pattern.test(f.name)).map(f => f.name);
    } catch { return []; }
}

function _githubContentsUrl(path) {
    const host = window.location.hostname;
    if (!host.endsWith('.github.io')) return null;
    const owner = host.replace('.github.io', '');
    const repo  = window.location.pathname.split('/').filter(Boolean)[0];
    if (!repo) return null;
    return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

function mediaSection(files) {
    if (!files.length) return '';
    const items = files.map(f => {
        const url     = `${_base}/data/media/${encodeURIComponent(f)}`;
        const isVideo = /\.(mp4|mov|webm)$/i.test(f);
        if (isVideo) {
            return `<video class="media-video" src="${url}" controls preload="none"></video>`;
        }
        return `<img class="media-thumb" src="${url}" alt="${f}" loading="lazy" data-fullsrc="${url}">`;
    }).join('');
    return `
        <details class="journal-note-block" open>
            <summary class="journal-note-label">Media</summary>
            <div class="media-grid">${items}</div>
        </details>
    `;
}

function _initLightbox() {
    const lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.className = 'lightbox';
    lb.hidden = true;
    lb.innerHTML = '<img class="lightbox-img" src="" alt="">';
    document.body.appendChild(lb);

    document.getElementById('journal-list').addEventListener('click', e => {
        const thumb = e.target.closest('.media-thumb');
        if (thumb) {
            lb.querySelector('.lightbox-img').src = thumb.dataset.fullsrc;
            lb.hidden = false;
        }
    });

    lb.addEventListener('click', () => { lb.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.hidden = true; });
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-SE', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
}
