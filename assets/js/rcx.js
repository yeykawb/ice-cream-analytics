/**
 * rcx.js — IceCreamCalc .rcx (XML) parser.
 * Converts a single RCX export into the three data structures
 * that db.js feeds into DuckDB: batch row, evaluation row, ingredient rows.
 */

/**
 * Strip RTF markup and return plain text.
 * Handles: nested groups {…}, control words \word, \wordN, \'xx hex chars,
 * and \par / \line paragraph breaks. Works on IceCreamCalc's simple single-font notes.
 */
function rtfToPlain(rtf) {
    if (!rtf) return '';

    let text  = '';
    let depth = 0;
    let i     = 0;

    while (i < rtf.length) {
        const ch = rtf[i];

        if (ch === '{') {
            depth++;
            i++;
        } else if (ch === '}') {
            depth--;
            i++;
        } else if (ch === '\\') {
            i++;
            if (i >= rtf.length) break;
            const next = rtf[i];

            if (next === "'") {
                // \'xx  — hex-encoded character (Windows-1252)
                const code = parseInt(rtf.slice(i + 1, i + 3), 16);
                if (depth === 1 && !isNaN(code)) text += String.fromCharCode(code);
                i += 3;
            } else if (next === '\n' || next === '\r') {
                // \<newline> — ignored in RTF source
                i++;
            } else if (/[a-z*]/i.test(next)) {
                // Control word: \word  or  \word-N
                let word = '';
                while (i < rtf.length && /[a-z]/i.test(rtf[i])) word += rtf[i++];
                while (i < rtf.length && /[\d-]/.test(rtf[i])) i++; // optional number
                if (i < rtf.length && rtf[i] === ' ')  i++;          // consume delimiter space

                if (depth === 1) {
                    if (word === 'par')  text += '\n';
                    if (word === 'line') text += '\n';
                    if (word === 'tab')  text += '\t';
                }
            } else {
                // Control symbol  \{  \}  \\  etc.
                if (depth === 1 && (next === '{' || next === '}' || next === '\\')) {
                    text += next;
                }
                i++;
            }
        } else if (depth === 1 && ch !== '\n' && ch !== '\r') {
            // Plain text at body depth — bare newlines in the RTF source are ignored
            text += ch;
            i++;
        } else {
            i++;
        }
    }

    // Collapse runs of blank lines to a single blank line, then trim
    return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function parseRCX(batchId, xmlText) {
    const doc  = new DOMParser().parseFromString(xmlText, 'text/xml');
    const root = doc.documentElement; // <Recipe>

    // Get the text of a direct child of <Recipe> by tag name (case-sensitive XML)
    const dc    = tag => Array.from(root.children).find(el => el.tagName === tag) ?? null;
    const dcTxt = tag => dc(tag)?.textContent?.trim() ?? '';
    const dcNum = tag => parseFloat(dcTxt(tag)) || 0;

    // ── Recipe metadata ────────────────────────────────
    const name         = dcTxt('Name');
    const recipe_label = name;
    const recipe       = name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics (å→a, ö→o…)
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    const version = dcNum('Revision') || 1;
    const date    = dcTxt('CreatedDate');

    // ── Tags ───────────────────────────────────────────
    const tagsEl = dc('Tags');
    const tags   = tagsEl
        ? Array.from(tagsEl.querySelectorAll('Name'))
            .map(n => n.textContent.trim())
            .filter(Boolean)
            .join(', ')
        : '';

    const batch = { id: batchId, date, recipe, recipe_label, version, tags };

    // ── Evaluation (ratings + notes) ───────────────────
    const evaluation = {
        batch_id:         batchId,
        texture_score:    dcNum('RateTexture'),
        flavour_score:    dcNum('RateTaste'),
        appearance_score: dcNum('RateColor'),
        batch_info:       dcTxt('Info'),
        notes:            rtfToPlain(dcTxt('Rtf')),
    };

    // ── Ingredients ────────────────────────────────────
    const ingredientRows = [];

    doc.querySelectorAll('Ingredients > Ingredient').forEach(ing => {
        const g = tag => parseFloat(ing.querySelector(tag)?.textContent) || 0;
        const s = tag => ing.querySelector(tag)?.textContent?.trim() ?? '';

        const amount_g  = g('Weight');           // inside <Item><Weight>
        const fat_pct   = g('totalfat')    * 100;
        const water_pct = g('water')       * 100;
        const msnf_pct  = g('msnf')        * 100;
        const sugar_pct = g('totalsugars') * 100;
        const pac_coeff = g('pac');
        const pod_coeff = g('pod');

        ingredientRows.push({
            batch_id:        batchId,
            ingredient_name: s('name'),           // lowercase in RCX
            amount_g,
            fat_pct,
            water_pct,
            msnf_pct,
            sugar_pct,
            pac_coeff,
            pod_coeff,
            fat_g:       amount_g * fat_pct   / 100,
            msnf_g:      amount_g * msnf_pct  / 100,
            sugar_g:     amount_g * sugar_pct / 100,
            water_g:     amount_g * water_pct / 100,
            pac_contrib: amount_g * pac_coeff,
            pod_contrib: amount_g * pod_coeff,
        });
    });

    return { batch, evaluation, ingredientRows };
}
