// Sweep comparison: given a library folder holding several uploads (one per
// mode) -- and optionally sub-folders (one per pass) -- build a per-task /
// per-mode comparison with solved counts, step/token aggregates, Δ-vs-baseline,
// a pass/scope toggle, and a downloadable self-contained HTML report.
import { extractRecords } from './fileHandling.js';
import { getResolvedStatus } from './utils.js';
// Fold a trace's records into per-task cells. Multiple records per task
// (retries / a litellm session) accumulate: steps = graded-record count is
// wrong, so steps = LLM-call records; out = Σ completion; in = max prompt
// (final context, counted once); resolved = solved wins over fail.
function foldTrace(content) {
    const tasks = new Map();
    let recs;
    try {
        recs = extractRecords(content.trim());
    }
    catch {
        return tasks;
    }
    // group by task id first so per-call token sums attach to the right task
    for (const rec of recs) {
        const r = rec;
        const tid = r.instance_id || r.task_id;
        const status = getResolvedStatus(r);
        // a call record (has tokens) contributes steps/tokens; a grade record
        // (has resolved but no id sometimes) contributes the verdict
        if (!tid && status === null)
            continue;
        const key = tid || '(untitled)';
        let c = tasks.get(key);
        if (!c) {
            c = { resolved: null, steps: 0, out: 0, in: 0, spans: 0 };
            tasks.set(key, c);
        }
        if (typeof r.completion_tokens === 'number') {
            c.out += r.completion_tokens;
            c.steps += 1;
        }
        if (typeof r.prompt_tokens === 'number')
            c.in = Math.max(c.in, r.prompt_tokens);
        // spans: explicit field (from a collected bundle) or count tool-result messages in this call
        const sp = typeof r.spans === 'number' ? r.spans
            : Array.isArray(r.messages) ? r.messages.filter(m => m && (m.role === 'tool' || m.role === 'function')).length : 0;
        if (sp > c.spans)
            c.spans = sp;
        if (status !== null && (c.resolved !== true))
            c.resolved = status;
    }
    return tasks;
}
// A "mode" label from an upload name: strip common run-id / extension noise.
function modeLabel(name) {
    return name.replace(/\.(jsonl?|json|txt)$/i, '')
        .replace(/[_-]?(pass\d+|p\d+|r\d+|round-?\d+)$/i, '')
        .trim() || name;
}
// Build the model from a folder: sub-folders => passes; direct uploads => modes.
export function buildSweep(store, folderId, folderName) {
    const subfolders = store.foldersIn(folderId);
    const data = new Map();
    const modeSet = new Set();
    const taskSet = new Set();
    const addPass = (label, uploads) => {
        const mm = new Map();
        for (const u of uploads) {
            const ml = modeLabel(u.name);
            const tm = foldTrace(u.content);
            if (tm.size === 0)
                continue;
            modeSet.add(ml);
            tm.forEach((_, t) => taskSet.add(t));
            // merge if the same mode label appears twice in a pass
            const prev = mm.get(ml);
            if (prev) {
                tm.forEach((c, t) => { if (!prev.has(t))
                    prev.set(t, c); });
            }
            else
                mm.set(ml, tm);
        }
        if (mm.size)
            data.set(label, mm);
    };
    if (subfolders.length > 0) {
        // multi-pass: each subfolder is a pass (natural sort by name)
        const sorted = [...subfolders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        sorted.forEach((f, i) => addPass(f.name || `Pass ${i + 1}`, store.uploadsIn(f.id)));
        // also fold any uploads sitting directly in the root as an extra pass
        const rootUploads = store.uploadsIn(folderId);
        if (rootUploads.length)
            addPass('Ungrouped', rootUploads);
    }
    else {
        addPass('Pass 1', store.uploadsIn(folderId));
    }
    const modes = [...modeSet].sort();
    const passes = [...data.keys()];
    const tasks = [...taskSet].sort();
    // union pass: solved in ANY pass; tokens/steps from a solved pass (else max-graded)
    const unionLabel = passes.length > 1 ? `pass@${passes.length} union` : 'Overall';
    const union = new Map();
    for (const m of modes) {
        const tm = new Map();
        for (const t of tasks) {
            let best = null;
            for (const p of passes) {
                const c = data.get(p)?.get(m)?.get(t);
                if (!c)
                    continue;
                if (!best)
                    best = { ...c };
                if (c.resolved === true) {
                    best = { ...c };
                    break;
                }
            }
            if (best)
                tm.set(t, best);
        }
        union.set(m, tm);
    }
    data.set(unionLabel, union);
    // common = solved by every mode in the union
    const common = tasks.filter(t => modes.every(m => union.get(m)?.get(t)?.resolved === true));
    // baseline: prefer an "upstream"/"baseline"/"off" mode, else first
    const baseline = modes.find(m => /upstream|baseline|stock|v0\.5|^off/i.test(m)) || modes[0] || '';
    return {
        passes: [...passes, unionLabel],
        modes, baseline, tasks, common,
        data, unionLabel,
        title: folderName,
    };
}
// ---- aggregation for a (pass, scope) ----
function aggregate(model, pass, scopeTasks) {
    const out = new Map();
    const mm = model.data.get(pass);
    for (const m of model.modes) {
        const tm = mm.get(m) || new Map();
        let a = { sol: 0, grd: 0, steps: 0, out: 0, in: 0, tot: 0, spans: 0, spanN: 0, solO: 0, grdO: 0 };
        for (const t of scopeTasks) {
            const c = tm.get(t);
            if (!c)
                continue;
            if (c.resolved === true)
                a.sol++;
            if (c.resolved !== null) {
                a.grd++;
                a.spans += c.spans;
                a.spanN++;
            }
            // sum every component over tasks so Total == Σ per-task (in+out),
            // consistent with the matrix (was: max(in) + Σout -> mixed max+sum bug).
            a.steps += c.steps;
            a.out += c.out;
            a.in += c.in;
        }
        // solO/grdO = coverage over ALL tasks so the Solved column stays x/20 in common scope.
        for (const t of model.tasks) {
            const c = tm.get(t);
            if (!c)
                continue;
            if (c.resolved === true)
                a.solO++;
            if (c.resolved !== null)
                a.grdO++;
        }
        a.tot = a.out + a.in;
        out.set(m, a);
    }
    return out;
}
const nf = (n) => n ? n.toLocaleString() : '—';
const shortTask = (t) => t.replace(/__/g, '/');
function deltaCell(v, base, isBaseline, goodDown = true) {
    if (isBaseline)
        return '<span class="sw-base">baseline</span>';
    const d = v - base;
    if (d === 0)
        return '<span class="sw-dz">0 (0%)</span>';
    const good = goodDown ? d < 0 : d > 0;
    const pct = base ? Math.round(d / base * 1000) / 10 : 0;
    const p = base ? ` <span class="sw-pct">(${d > 0 ? '+' : ''}${pct}%)</span>` : '';
    return `<span class="${good ? 'sw-dpos' : 'sw-dneg'}">${d > 0 ? '+' : '-'}${nf(Math.abs(d))}${p}</span>`;
}
// common = tasks solved by every mode IN A GIVEN pass (per-pass on Pass 1/2/3;
// the union set only when pass is the union label).
function commonForPass(model, pass) {
    const mm = model.data.get(pass);
    if (!mm)
        return [];
    return model.tasks.filter(t => model.modes.every(m => mm.get(m)?.get(t)?.resolved === true));
}
// Render the comparison HTML fragment (summary + matrix) for one (pass, scope).
export function renderSweepTables(model, pass, scope) {
    const commonTasks = commonForPass(model, pass);
    const scopeTasks = scope === 'common' ? commonTasks : model.tasks;
    const agg = aggregate(model, pass, scopeTasks);
    const base = agg.get(model.baseline);
    const mm = model.data.get(pass);
    const spAvg = (a) => a.spanN ? Math.round(a.spans / a.spanN * 10) / 10 : 0;
    // real passes = all pass labels except the synthetic union -> each mode's per-pass
    // solve counts, so the Solved cell shows the AVERAGE per pass (X.X/N) with the
    // individual pass counts below (what compounds the average). Mirrors the canonical
    // build_sglang_report.py template.
    const realPasses = model.passes.filter(p => p !== model.unionLabel);
    const perPassSolved = (mode) => realPasses.map(pl => {
        const pd = model.data.get(pl);
        if (!pd || !pd.get(mode))
            return 0;
        let s = 0;
        for (const t of model.tasks) {
            if (pd.get(mode).get(t)?.resolved === true)
                s++;
        }
        return s;
    });
    const solHdr = 'Solved<br><span style="font-weight:400;opacity:.7">avg/pass of ' + model.tasks.length + '</span>';
    const grpLabel = scope === 'common'
        ? `← over the ${commonTasks.length} tasks solved by <b>all modes in ${pass}</b> (same-work comparison) →`
        : `← over all ${scopeTasks.length} tasks →`;
    let sum = `<table class="sw-tab"><thead>
      <tr><th class="sw-task" style="border-bottom:0"></th><th style="border-bottom:0"></th>
      <th colspan="8" style="font-weight:600;color:#0d9488">${grpLabel}</th></tr>
      <tr><th class="sw-task">Mode</th><th>${solHdr}</th><th>Spans<br><span style="font-weight:400;opacity:.7">avg · Σ</span></th><th>Steps</th><th>Δst</th>
      <th>Σ Out</th><th>Δout</th><th>Σ In</th><th>Total</th><th>Δtot</th></tr></thead><tbody>`;
    for (const m of model.modes) {
        const a = agg.get(m);
        const isB = m === model.baseline;
        // Solved cell = AVERAGE per-pass solve count (X.X/N) with the per-pass counts
        // below. Denominator is the full task set so every mode/pass shares one base.
        const pps = perPassSolved(m);
        const avgPP = Math.round(pps.reduce((s, x) => s + x, 0) / (pps.length || 1) * 10) / 10;
        sum += `<tr><td class="sw-task">${escape(m)}</td>
          <td><span class="sw-ok">${avgPP}</span>/${model.tasks.length}<br><span style="opacity:.6;font-weight:400;font-size:.85em">${pps.join(' · ')}</span></td>
          <td class="sw-num"><b>${spAvg(a)}</b> · ${nf(a.spans)}</td>
          <td class="sw-num">${nf(a.steps)}</td><td class="sw-num">${deltaCell(a.steps, base.steps, isB)}</td>
          <td class="sw-num">${nf(a.out)}</td><td class="sw-num">${deltaCell(a.out, base.out, isB)}</td>
          <td class="sw-num">${nf(a.in)}</td><td class="sw-num">${nf(a.tot)}</td>
          <td class="sw-num">${deltaCell(a.tot, base.tot, isB)}</td></tr>`;
    }
    // average
    const avg = (k) => Math.round(model.modes.reduce((s, m) => s + agg.get(m)[k], 0) / (model.modes.length || 1));
    const avgSpAvg = Math.round(model.modes.reduce((s, m) => s + spAvg(agg.get(m)), 0) / (model.modes.length || 1) * 10) / 10;
    // each mode's own avg-per-pass, then averaged across modes (matches per-mode cells)
    const modeAvgPP = model.modes.map(m => { const p = perPassSolved(m); return p.reduce((s, x) => s + x, 0) / (p.length || 1); });
    const avgSolO = Math.round(modeAvgPP.reduce((s, x) => s + x, 0) / (modeAvgPP.length || 1) * 10) / 10;
    const solBreak = modeAvgPP.map(x => Math.round(x * 10) / 10).join('·');
    sum += `<tr class="sw-av"><td class="sw-task">Avg (across modes)</td>
      <td><b>${avgSolO}</b>/${model.tasks.length} <span style="font-weight:400;opacity:.7">(${solBreak} by mode)</span></td><td class="sw-num"><b>${avgSpAvg}</b> · ${nf(avg('spans'))}</td><td class="sw-num">${nf(avg('steps'))}</td><td></td>
      <td class="sw-num">${nf(avg('out'))}</td><td></td><td class="sw-num">${nf(avg('in'))}</td>
      <td class="sw-num">${nf(avg('tot'))}</td><td></td></tr></tbody></table>`;
    // matrix
    let mx = `<table class="sw-tab"><thead><tr><th class="sw-task">Task</th>${model.modes.map(m => `<th>${escape(m)}</th>`).join('')}</tr></thead><tbody>`;
    for (const t of scopeTasks) {
        const solAll = model.modes.every(m => mm.get(m)?.get(t)?.resolved === true);
        let row = `<td class="sw-task">${solAll ? '<span class="sw-star">★</span> ' : ''}${escape(shortTask(t))}</td>`;
        for (const m of model.modes) {
            const c = mm.get(m)?.get(t);
            if (!c || c.resolved === null) {
                row += '<td><span class="sw-rn">·</span></td>';
                continue;
            }
            const v = c.resolved ? '<span class="sw-ok">✓</span>' : '<span class="sw-bad">✗</span>';
            row += `<td class="sw-mx">${v} · <b>${c.spans}sp</b> · ${c.steps}st · ${nf(c.out + c.in)}</td>`;
        }
        mx += `<tr${solAll ? ' class="sw-common"' : ''}>${row}</tr>`;
    }
    mx += '</tbody></table>';
    return `<div class="sw-cardttl">Summary — ${escape(labelOf(model, pass))}${scope === 'common' ? ' — common tasks only' : ''}</div>${sum}
      <div class="sw-cardttl">Per-task matrix — ${escape(labelOf(model, pass))}, ${scopeTasks.length} tasks</div>${mx}`;
}
function labelOf(model, pass) { return pass; }
// ---- full-screen overlay shown from the sidebar's folder "Compare" action ----
export function openSweepOverlay(store, folderId, folderName) {
    const model = buildSweep(store, folderId, folderName);
    if (!model.modes.length) {
        alert('This folder has no gradeable traces to compare.');
        return;
    }
    let pass = model.passes[model.passes.length - 1]; // default: union
    let scope = 'common';
    const overlay = document.createElement('div');
    overlay.className = 'sweep-overlay';
    overlay.innerHTML = `
      <div class="sweep-panel">
        <div class="sweep-bar">
          <span class="sweep-title">📊 ${escape(folderName)} — sweep comparison</span>
          <span class="sweep-modes">${model.modes.length} modes × ${model.passes.length - 1} passes · ${model.tasks.length} tasks</span>
          <span class="sweep-spacer"></span>
          <button class="sweep-btn" data-act="html">⬇ HTML report</button>
          <button class="sweep-btn sweep-close" data-act="close">✕</button>
        </div>
        <div class="sweep-ctl">
          <div class="sweep-grp"><b>View</b><span id="sweepPasses"></span></div>
          <div class="sweep-grp"><b>Scope</b>
            <button data-sc="common" class="on">Solved by all</button>
            <button data-sc="all">All tasks</button></div>
        </div>
        <div class="sweep-scopenote" id="sweepScopeNote"></div>
        <div class="sweep-body" id="sweepBody"></div>
      </div>`;
    const body = overlay.querySelector('#sweepBody');
    const passBtns = overlay.querySelector('#sweepPasses');
    const scopeNote = overlay.querySelector('#sweepScopeNote');
    const rerender = () => {
        body.innerHTML = renderSweepTables(model, pass, scope);
        const cp = commonForPass(model, pass);
        scopeNote.innerHTML = scope === 'common'
            ? `Token/step columns use the <b>${cp.length} tasks solved by every mode in ${pass}</b>: ${cp.map(shortTask).map(escape).join(', ') || '<i>none</i>'}. The <b>Solved</b> column still shows each mode's full x/${model.tasks.length} coverage.`
            : '';
    };
    model.passes.forEach(p => {
        const b = document.createElement('button');
        b.textContent = p;
        if (p === pass)
            b.classList.add('on');
        b.onclick = () => { pass = p; passBtns.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.textContent === p)); rerender(); };
        passBtns.appendChild(b);
    });
    overlay.querySelectorAll('[data-sc]').forEach(b => {
        b.onclick = () => { scope = b.dataset.sc; overlay.querySelectorAll('[data-sc]').forEach(x => x.classList.toggle('on', x === b)); rerender(); };
    });
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') {
        e.preventDefault();
        close();
    } };
    overlay.querySelector('[data-act="close"]')?.addEventListener('click', close);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay)
        close(); });
    overlay.querySelector('[data-act="html"]')?.addEventListener('click', () => {
        const html = exportSweepHtml(model);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName.replace(/[^\w.-]+/g, '_')}_sweep_report.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    rerender();
}
function escape(s) {
    return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}
// ---- standalone HTML report export (self-contained, theme-aware) ----
export function exportSweepHtml(model) {
    // serialize a compact blob and reuse a client-side renderer identical in
    // shape to the in-app one, so the downloaded file is fully interactive.
    const blob = { title: model.title, baseline: model.baseline, modes: model.modes,
        passes: model.passes, tasks: model.tasks.map(shortTask), taskids: model.tasks,
        common: model.common.map(shortTask), commonids: model.common, data: {} };
    for (const p of model.passes) {
        blob.data[p] = {};
        const mm = model.data.get(p);
        for (const m of model.modes) {
            blob.data[p][m] = {};
            for (const t of model.tasks) {
                const c = mm.get(m)?.get(t);
                blob.data[p][m][t] = c ? [c.resolved === true ? 1 : c.resolved === false ? 0 : -1, c.steps, c.out, c.in, c.spans] : [-1, 0, 0, 0, 0];
            }
        }
    }
    return REPORT_HTML.replace('__SWEEP_META__', JSON.stringify(blob));
}
// The exported report template mirrors kvcache-bench build_sglang_report.py.
const REPORT_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Sweep report</title>
<style>
:root{--bg:#f5f7fa;--card:#fff;--ink:#1a1a2e;--mut:#5a6072;--line:#e3e8f0;--accent:#2c3e50;--ok:#1e8449;--bad:#c0392b;--rn:#a0a6b4;--hi:#e8f6ee;--avg:#eef2fd;--acc2:#6c5ce7}
@media(prefers-color-scheme:dark){:root{--bg:#12141c;--card:#1b1e28;--ink:#e6e9f0;--mut:#9aa0b0;--line:#2a2e3a;--accent:#c8cfe0;--ok:#4cd07d;--bad:#ff6b6b;--rn:#6b7280;--hi:#16341f;--avg:#1c2236;--acc2:#a29bfe}}
:root[data-theme=dark]{--bg:#12141c;--card:#1b1e28;--ink:#e6e9f0;--mut:#9aa0b0;--line:#2a2e3a;--accent:#c8cfe0;--ok:#4cd07d;--bad:#ff6b6b;--rn:#6b7280;--hi:#16341f;--avg:#1c2236;--acc2:#a29bfe}
:root[data-theme=light]{--bg:#f5f7fa;--card:#fff;--ink:#1a1a2e;--mut:#5a6072;--line:#e3e8f0;--accent:#2c3e50;--ok:#1e8449;--bad:#c0392b;--rn:#a0a6b4;--hi:#e8f6ee;--avg:#eef2fd;--acc2:#6c5ce7}
.pct{opacity:.72;font-size:.9em}
.themebtn{position:fixed;top:14px;right:16px;z-index:50;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:.82rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:22px 30px;background:var(--bg);color:var(--ink)}
h1{margin:0 0 3px;font-size:1.4rem}.sub{color:var(--mut);font-size:.86rem;margin-bottom:14px}
.ctl{display:flex;gap:22px;flex-wrap:wrap;align-items:center;margin:0 0 14px;font-size:.82rem}
.grp{display:flex;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:3px}
.grp b{color:var(--mut);font-weight:600;padding:5px 8px;align-self:center;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.ctl button{border:0;background:transparent;color:var(--ink);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:.82rem}
.ctl button.on{background:#0d9488;color:#fff}
@media(prefers-color-scheme:dark){.ctl button.on{background:#14b8a6;color:#04201c}}
:root[data-theme=dark] .ctl button.on{background:#14b8a6;color:#04201c}
:root[data-theme=light] .ctl button.on{background:#0d9488;color:#fff}
.card{background:var(--card);border-radius:9px;box-shadow:0 1px 3px rgba(0,0,0,.07);margin-bottom:16px;overflow:auto}
.ttl{background:linear-gradient(90deg,color-mix(in srgb,var(--acc2) 16%,var(--card)),color-mix(in srgb,var(--acc2) 8%,var(--card)));color:var(--ink);padding:8px 14px;font-family:ui-monospace,Menlo,monospace;font-size:.82rem;font-weight:600;border-bottom:1px solid var(--line)}
table{width:100%;border-collapse:collapse;font-size:.82rem}thead tr{background:color-mix(in srgb,var(--accent) 8%,var(--card))}
th{padding:7px 10px;text-align:center;font-weight:600;color:var(--mut);font-size:.72rem;border-bottom:2px solid var(--line);border-right:1px solid var(--line);white-space:nowrap}
td{padding:6px 10px;text-align:center;border-bottom:1px solid var(--line);border-right:1px solid var(--line)}
.task{text-align:left;font-family:ui-monospace,Menlo,monospace;font-size:.77rem;white-space:nowrap}
.num{font-family:ui-monospace,Menlo,monospace;text-align:right}.ok{color:var(--ok);font-weight:700}.bad{color:var(--bad);font-weight:700}
.rn{color:var(--rn);font-style:italic}.av td{background:var(--avg);font-weight:700}.dpos{color:var(--ok)}.dneg{color:var(--bad)}.dz{color:var(--mut)}
.base{color:var(--mut);font-style:italic}.star{color:#e0a800}tr.common td.task{background:var(--hi)}.mx{font-family:ui-monospace,Menlo,monospace;font-size:.74rem}
.legend{font-size:.76rem;color:var(--mut);margin:-6px 0 14px;line-height:1.5}
</style></head><body>
<button class="themebtn" id="themebtn" onclick="toggleTheme()">☾ Theme</button>
<h1 id="h"></h1><div class="sub" id="sub"></div>
<div class="ctl"><div class="grp"><b>View</b><span id="pb"></span></div>
<div class="grp"><b>Scope</b><button data-sc=common class=on onclick="sc('common')">Solved by all</button>
<button data-sc=all onclick="sc('all')">All tasks</button></div></div>
<div class="legend" id="scn"></div>
<div class="card"><div class="ttl" id="st">Summary</div><table id="t1"></table></div>
<div class="card"><div class="ttl">Per-task matrix — <span id="mxs"></span></div><table id="t2"></table></div>
<div class="legend">Cell: <span class="ok">✓</span>/<span class="bad">✗</span> · <i>N</i>st · <b>total tokens</b> = final-context (max prompt_tokens) + Σ generated. Context is append-only, so the final context is the union of all inputs — every token counted <b>once</b> (not Σ-of-requests). <span class="star">★</span> = solved by every mode. <span class="rn">·</span> = not graded.</div>
<script>const M=__SWEEP_META__;const nf=n=>n?Number(n).toLocaleString():'—';let P=M.passes[M.passes.length-1],S='all';
function commonP(){const pd=M.data[P];return M.taskids.filter(t=>M.modes.every(k=>pd[k][t]&&pd[k][t][0]===1))}
function ids(){return S==='common'?commonP():M.taskids}function sh(t){return M.tasks[M.taskids.indexOf(t)]}
function dl(v,b,isB,gd){if(isB)return '<span class=base>baseline</span>';const d=v-b;if(!d)return '<span class=dz>0 (0%)</span>';const g=gd?d<0:d>0;const pct=b?Math.round(d/b*1000)/10:0;const p=b?' <span class=pct>('+(d>0?'+':'')+pct+'%)</span>':'';return '<span class="'+(g?'dpos':'dneg')+'">'+(d>0?'+':'-')+nf(Math.abs(d))+p+'</span>'}
function build(){const pd=M.data[P],ts=ids(),ag={};M.modes.forEach(k=>{let so=0,g=0,st=0,o=0,i=0,sp=0,spn=0,soO=0,gO=0;ts.forEach(t=>{const c=pd[k][t];if(!c)return;if(c[0]===1)so++;if(c[0]>=0){g++;sp+=(c[4]||0);spn++;}st+=c[1];o+=c[2];i+=c[3]});M.taskids.forEach(t=>{const c=pd[k][t];if(!c)return;if(c[0]===1)soO++;if(c[0]>=0)gO++;});ag[k]={so,g,st,o,i,tot:o+i,sp,spavg:spn?sp/spn:0,soO,gO}});
const b=ag[M.baseline];const solHdr=S==='common'?'Solved<br><span style="font-weight:400;opacity:.7">of '+M.taskids.length+'</span>':'Solved';const grpLabel=S==='common'?'← over the '+ts.length+' tasks solved by <b>all modes in '+P+'</b> (same-work comparison) →':'← over all '+ts.length+' tasks →';let h='<thead><tr><th class=task style="text-align:left;border-bottom:0"></th><th style="border-bottom:0"></th><th colspan=8 style="font-weight:600;color:#0d9488">'+grpLabel+'</th></tr><tr><th class=task style="text-align:left">Mode</th><th>'+solHdr+'</th><th>Spans<br><span style="font-weight:400;opacity:.7">avg · Σ</span></th><th>Steps</th><th>Δst</th><th>Σ Out</th><th>Δout</th><th>Σ In</th><th>Total</th><th>Δtot</th></tr></thead><tbody>';
M.modes.forEach(k=>{const a=ag[k],isB=k===M.baseline;h+='<tr><td class=task>'+k+'</td><td><span class=ok>'+a.soO+'</span>/'+a.gO+'</td><td class=num><b>'+(Math.round(a.spavg*10)/10)+'</b> · '+nf(a.sp)+'</td><td class=num>'+nf(a.st)+'</td><td class=num>'+dl(a.st,b.st,isB,1)+'</td><td class=num>'+nf(a.o)+'</td><td class=num>'+dl(a.o,b.o,isB,1)+'</td><td class=num>'+nf(a.i)+'</td><td class=num>'+nf(a.tot)+'</td><td class=num>'+dl(a.tot,b.tot,isB,1)+'</td></tr>'});
const av=k=>Math.round(M.modes.reduce((s,m)=>s+ag[m][k],0)/M.modes.length);const avsp=Math.round(M.modes.reduce((s,m)=>s+ag[m].spavg,0)/M.modes.length*10)/10;const avsoO=Math.round(M.modes.reduce((s,m)=>s+ag[m].soO,0)/M.modes.length*10)/10;const solBreak=M.modes.map(m=>ag[m].soO).join('·');h+='<tr class=av><td class=task>Avg (across modes)</td><td><b>'+avsoO+'</b>/'+av('gO')+' <span style="font-weight:400;opacity:.7">('+solBreak+')</span></td><td class=num><b>'+avsp+'</b> · '+nf(av('sp'))+'</td><td class=num>'+nf(av('st'))+'</td><td></td><td class=num>'+nf(av('o'))+'</td><td></td><td class=num>'+nf(av('i'))+'</td><td class=num>'+nf(av('tot'))+'</td><td></td></tr></tbody>';document.getElementById('t1').innerHTML=h;document.getElementById('st').textContent='Summary — '+P+(S==='common'?' — common only':'');document.getElementById('scn').innerHTML=S==='common'?'Token/step columns use the <b>'+ts.length+' tasks solved by every mode in '+P+'</b>: '+ts.map(sh).join(', ')+'. The <b>Solved</b> column still shows each mode\\'s full x/'+M.taskids.length+' coverage.':'';
let m='<thead><tr><th class=task style="text-align:left">Task</th>'+M.modes.map(k=>'<th>'+k+'</th>').join('')+'</tr></thead><tbody>';ts.forEach(t=>{const sa=M.modes.every(k=>pd[k][t]&&pd[k][t][0]===1);let r='<td class=task>'+(sa?'<span class=star>★</span> ':'')+sh(t)+'</td>';M.modes.forEach(k=>{const c=pd[k][t];if(!c||c[0]===-1){r+='<td><span class=rn>·</span></td>';return}r+='<td class=mx>'+(c[0]===1?'<span class=ok>✓</span>':'<span class=bad>✗</span>')+' · <b>'+(c[4]||0)+'sp</b> · '+c[1]+'st · '+nf(c[2]+c[3])+'</td>'});m+='<tr'+(sa?' class=common':'')+'>'+r+'</tr>'});m+='</tbody>';document.getElementById('t2').innerHTML=m;document.getElementById('mxs').textContent=P+', '+ts.length+' tasks'}
function setP(p){P=p;document.querySelectorAll('#pb button').forEach(x=>x.classList.toggle('on',x.dataset.p===p));build()}
function sc(s){S=s;document.querySelectorAll('[data-sc]').forEach(x=>x.classList.toggle('on',x.dataset.sc===s));build()}
function curTheme(){return document.documentElement.getAttribute('data-theme')||(window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')}
function applyTheme(t){document.documentElement.setAttribute('data-theme',t);document.getElementById('themebtn').innerHTML=(t==='dark'?'☀ Light':'☾ Dark');try{localStorage.setItem('sw_theme',t)}catch(e){}}
function toggleTheme(){applyTheme(curTheme()==='dark'?'light':'dark')}
(function(){let t;try{t=localStorage.getItem('sw_theme')}catch(e){}applyTheme(t||curTheme())})();
document.getElementById('h').textContent=M.title||'Sweep report';document.getElementById('sub').textContent=M.modes.length+' modes × '+(M.passes.length-1)+' passes · '+M.taskids.length+' tasks';
const pb=document.getElementById('pb');M.passes.forEach(p=>{const b=document.createElement('button');b.dataset.p=p;b.textContent=p;b.onclick=()=>setP(p);if(p===P)b.classList.add('on');pb.appendChild(b)});sc('common');build();</script>
</body></html>`;
//# sourceMappingURL=sweep.js.map