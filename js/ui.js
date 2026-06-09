import { escapeHtml, getResolvedStatus, getStatusColor, getStatusText } from './utils.js';
export class UI {
    constructor(containerId, maxDumps = 4) {
        this.callbacks = new Map();
        const el = document.getElementById(containerId);
        if (!el)
            throw new Error(`Container with id ${containerId} not found`);
        this.container = el;
        this.maxDumps = maxDumps;
    }
    renderDumps(dumps) {
        this.container.innerHTML = dumps.map((dump, idx) => {
            const loaded = dump.requests.length > 0;
            const dropZone = loaded
                ? `<div class="drop-zone compact" id="dropZone-${idx}" onclick="window.app.fileHandler.triggerFileInput(${idx})">↻ replace file</div>`
                : `<div class="drop-zone" id="dropZone-${idx}" onclick="window.app.fileHandler.triggerFileInput(${idx})">
                        <div class="drop-zone-text">📁</div>
                        <div class="drop-zone-sub">Drag file or click</div>
                   </div>`;
            const body = !loaded
                ? '<div class="no-data">No data</div>'
                : isSession(dump.requests)
                    ? `<div class="dump-content conversation" id="content-${idx}"></div>`
                    : `<div class="request-nav" id="nav-${idx}"></div>
                       <div class="dump-content" id="content-${idx}"></div>`;
            return `
            <div class="dump-panel">
                <div class="dump-header">
                    <div class="dump-title" id="title-${idx}" ondblclick="window.app.editName(${idx})">${escapeHtml(dump.name)}</div>
                    <button class="remove-btn" onclick="window.app.removeDump(${idx})">✕</button>
                </div>
                ${dropZone}
                ${body}
            </div>`;
        }).join('');
        dumps.forEach((dump, idx) => {
            if (dump.requests.length > 0) {
                if (isSession(dump.requests)) {
                    this.renderConversation(idx, dump.requests);
                }
                else {
                    this.renderNav(idx, dump.requests.length);
                    this.renderRequest(idx, 0, dump.requests[0]);
                }
            }
            this.setupDropZone(idx);
        });
    }
    // ---- Session view: stitch the LLM calls into one scrollable chat ----
    renderConversation(dumpIdx, requests) {
        const el = document.getElementById(`content-${dumpIdx}`);
        if (!el)
            return;
        const events = reconstructEvents(requests);
        const totalP = sum(requests.map(r => r.prompt_tokens));
        const totalC = sum(requests.map(r => r.completion_tokens));
        const model = requests.find(r => r.model)?.model || '';
        let html = `<div class="session-summary">
            ${model ? `<span class="pill">${escapeHtml(model)}</span>` : ''}
            <span>${requests.length} call${requests.length === 1 ? '' : 's'}</span>
            <span>${fmt(totalP)} in / ${fmt(totalC)} out tokens</span>
        </div><div class="chat">`;
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.kind === 'system') {
                html += `<details class="msg system"><summary>⚙ System prompt (${fmt(ev.text.length)} chars)</summary><pre class="code">${escapeHtml(ev.text)}</pre></details>`;
            }
            else if (ev.kind === 'user') {
                html += msgRow('user', '👤 User', `<div class="msg-text">${escapeHtml(ev.text)}</div>`);
            }
            else if (ev.kind === 'observation') {
                html += toolCard('Output', '', ev.text, 'out-only');
            }
            else if (ev.kind === 'step') {
                const action = parseAction(ev.action);
                let inner = '';
                if (action.thought)
                    inner += `<div class="msg-text">${escapeHtml(action.thought)}</div>`;
                if (action.code) {
                    // Pair the code with the observation that immediately follows it.
                    let out = null;
                    if (i + 1 < events.length && events[i + 1].kind === 'observation') {
                        out = events[i + 1].text;
                        i++;
                    }
                    inner += toolCard('Code', action.code, out, out === null ? 'in-only' : '');
                }
                if (!action.thought && !action.code) {
                    inner += `<div class="msg-text">${escapeHtml(ev.action)}</div>`;
                }
                html += `<div class="step-div"><span>${escapeHtml(ev.label)}${ev.tokens ? ' · ' + ev.tokens : ''}</span></div>`;
                html += msgRow('assistant', '🤖 Assistant', inner);
            }
        }
        html += '</div>';
        el.innerHTML = html;
    }
    // ---- Multi-instance view (each record is a separate task): keep tabs ----
    renderNav(dumpIdx, requestCount) {
        const nav = document.getElementById(`nav-${dumpIdx}`);
        if (!nav)
            return;
        nav.innerHTML = Array.from({ length: requestCount }, (_, i) => `
            <button class="req-btn ${i === 0 ? 'active' : ''}" onclick="window.app.selectRequest(${i}, ${dumpIdx})">R${i + 1}</button>
        `).join('');
    }
    renderRequest(dumpIdx, reqIdx, req) {
        const contentEl = document.getElementById(`content-${dumpIdx}`);
        if (!contentEl || !req)
            return;
        let html = '<div class="chat">';
        if (req.messages && Array.isArray(req.messages)) {
            req.messages.forEach(msg => {
                const role = msg.role || 'unknown';
                const label = role === 'user' ? '👤 User' : role === 'assistant' ? '🤖 Assistant' : '⚙ ' + role;
                const content = typeof msg.content === 'string' ? msg.content : '';
                if (role === 'system') {
                    html += `<details class="msg system"><summary>⚙ System prompt (${fmt(content.length)} chars)</summary><pre class="code">${escapeHtml(content)}</pre></details>`;
                }
                else {
                    html += msgRow(role, label, `<div class="msg-text">${escapeHtml(content)}</div>`);
                }
            });
        }
        else if (req.prompt) {
            html += msgRow('user', '👤 Input', `<div class="msg-text">${escapeHtml(req.prompt)}</div>`);
        }
        if (req.response) {
            const r = typeof req.response === 'string' ? req.response : JSON.stringify(req.response, null, 2);
            html += msgRow('assistant', '🤖 Response', `<div class="msg-text">${escapeHtml(r)}</div>`);
        }
        html += '</div>';
        const resolved = getResolvedStatus(req);
        if (resolved !== null) {
            html += `<div class="status-badge" style="border-left: 3px solid ${getStatusColor(resolved)};"><strong>${getStatusText(resolved)}</strong></div>`;
        }
        contentEl.innerHTML = html;
    }
    setupDropZone(idx) {
        const dropZone = document.getElementById(`dropZone-${idx}`);
        if (!dropZone)
            return;
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });
    }
    editDumpName(idx, dumps) {
        const titleEl = document.getElementById(`title-${idx}`);
        if (!titleEl)
            return;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = dumps[idx].name;
        input.onblur = () => {
            dumps[idx].name = input.value || `Dump ${idx + 1}`;
            this.renderDumps(dumps);
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter')
                input.blur();
        };
        titleEl.replaceWith(input);
        input.focus();
        input.select();
    }
    canAddDump(dumpCount) {
        return dumpCount < this.maxDumps;
    }
    on(event, callback) {
        this.callbacks.set(event, callback);
    }
}
// ---------- helpers ----------
function isSession(requests) {
    return requests.length > 0 && requests.every(r => r._session === true);
}
/**
 * Rebuild one linear conversation out of the per-call trace. Each call resends
 * the whole transcript so far; we emit only the NEW context per call (skipping
 * the folded copies of earlier assistant replies, which we already show as
 * steps) and attach each call's own response as that step's action.
 */
function reconstructEvents(requests) {
    const events = [];
    let shown = [];
    requests.forEach((req, i) => {
        const msgs = req.messages || [];
        const common = commonPrefixLen(shown, msgs);
        const fresh = msgs.slice(common);
        for (const m of fresh) {
            if (m.role === 'assistant')
                continue; // already emitted as a prior step
            if (m.role === 'system')
                events.push({ kind: 'system', text: m.content });
            else if (isToolResult(m.content))
                events.push({ kind: 'observation', text: m.content });
            else
                events.push({ kind: 'user', text: m.content });
        }
        const action = typeof req.response === 'string' ? req.response : JSON.stringify(req.response);
        const tokens = req.prompt_tokens != null
            ? `${fmt(req.prompt_tokens)}→${fmt(req.completion_tokens || 0)} tok`
            : '';
        events.push({ kind: 'step', label: `R${i + 1}`, tokens, action: action || '' });
        shown = msgs;
    });
    return events;
}
function commonPrefixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i].role === b[i].role && a[i].content === b[i].content)
        i++;
    return i;
}
function isToolResult(text) {
    return /^Call id:/.test(text) || /\bObservation:/.test(text) || /Code execution (failed|succeeded)/.test(text);
}
/** smolagents replies are JSON like {"thought": "...", "code": "..."}. */
function parseAction(text) {
    try {
        const o = JSON.parse(text);
        if (o && (typeof o.thought === 'string' || typeof o.code === 'string')) {
            return { thought: o.thought || '', code: o.code || '' };
        }
    }
    catch { /* not JSON; fall through */ }
    return { thought: '', code: '' };
}
function msgRow(role, label, innerHtml) {
    return `<div class="msg ${role}">
        <div class="msg-rail"><span class="dot"></span></div>
        <div class="msg-body"><div class="msg-role">${label}</div>${innerHtml}</div>
    </div>`;
}
function toolCard(head, inText, outText, mod) {
    let html = `<div class="tool-card ${mod}"><div class="tool-head">${escapeHtml(head)}</div>`;
    if (inText)
        html += `<div class="tool-io in"><span class="io-tag">IN</span><pre class="code">${escapeHtml(inText)}</pre></div>`;
    if (outText != null)
        html += `<div class="tool-io out"><span class="io-tag">OUT</span><pre class="code">${escapeHtml(outText)}</pre></div>`;
    html += '</div>';
    return html;
}
function sum(xs) {
    return xs.reduce((a, b) => a + (b || 0), 0);
}
function fmt(n) {
    return n.toLocaleString('en-US');
}
//# sourceMappingURL=ui.js.map