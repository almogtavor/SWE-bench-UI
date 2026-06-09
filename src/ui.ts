import { escapeHtml, getResolvedStatus, getStatusColor, getStatusText, statusPill, Request } from './utils.js';
import { renderMarkdown, highlightCode } from './markdown.js';
import { parseChoiceRepr } from './litellm.js';

export interface Dump {
    name: string;
    data: unknown | null;
    requests: Request[];
}

type Msg = { role: string; content: string };

// One thing to draw in the conversation, in chronological order.
type Event =
    | { kind: 'system'; text: string }
    | { kind: 'user'; text: string }
    | { kind: 'observation'; text: string }
    | { kind: 'step'; label: string; tokens: string; action: string; rawChoice: string };

export class UI {
    private container: HTMLElement;
    private maxDumps: number;
    private callbacks: Map<string, Function> = new Map();
    private parse = true; // render markdown + highlight code (toggleable)
    private parseApi = false; // parse raw litellm Choices() reprs into tool-call cards

    constructor(containerId: string, maxDumps: number = 4) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Container with id ${containerId} not found`);

        this.container = el;
        this.maxDumps = maxDumps;
    }

    getParse(): boolean { return this.parse; }
    setParse(on: boolean): void { this.parse = on; }
    getParseApi(): boolean { return this.parseApi; }
    setParseApi(on: boolean): void { this.parseApi = on; }

    renderDumps(dumps: Dump[]): void {
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
                    if (dump.requests[0]._kind === 'trajectory') this.renderTrajectory(idx, dump.requests);
                    else this.renderConversation(idx, dump.requests);
                } else {
                    this.renderNav(idx, dump.requests);
                    this.renderRequest(idx, 0, dump.requests[0]);
                }
            }
        });
    }

    // ---- Session view: stitch the LLM calls into one scrollable chat ----

    private renderConversation(dumpIdx: number, requests: Request[]): void {
        const el = document.getElementById(`content-${dumpIdx}`);
        if (!el) return;

        const events = reconstructEvents(requests);
        const totalP = sum(requests.map(r => r.prompt_tokens));
        const totalC = sum(requests.map(r => r.completion_tokens));
        const model = requests.find(r => r.model)?.model || '';

        let html = `<div class="session-summary">
            ${statusPill(sessionGrade(requests))}
            ${model ? `<span class="pill">${escapeHtml(model)}</span>` : ''}
            <span>${requests.length} call${requests.length === 1 ? '' : 's'}</span>
            <span>${fmt(totalP)} in / ${fmt(totalC)} out tokens</span>
        </div><div class="chat">`;

        const parse = this.parse;
        const parseApi = this.parseApi;
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.kind === 'system') {
                html += sysBlock(ev.text);
            } else if (ev.kind === 'user') {
                html += msgRow('user', '👤 User', textBox(ev.text, parse));
            } else if (ev.kind === 'observation') {
                html += toolCard('Output', '', ev.text, 'out-only', parse);
            } else if (ev.kind === 'step') {
                // The observation that immediately follows this step (if any) is
                // the tool/code result; pair it into the step's tool card.
                let out: string | null = null;
                if (i + 1 < events.length && events[i + 1].kind === 'observation') {
                    out = (events[i + 1] as { text: string }).text;
                    i++;
                }
                const inner = parseApi && ev.rawChoice
                    ? renderApiStep(ev.rawChoice, ev.action, out, parse)
                    : renderSmolStep(ev.action, out, parse);
                html += `<div class="step-div"><span>${escapeHtml(ev.label)}${ev.tokens ? ' · ' + ev.tokens : ''}</span></div>`;
                html += msgRow('assistant', '🤖 Assistant', inner);
            }
        }

        html += '</div>';
        el.innerHTML = html;
    }

    // ---- Trajectory view: action/observation tool-calling log ----

    private renderTrajectory(dumpIdx: number, recs: Request[]): void {
        const el = document.getElementById(`content-${dumpIdx}`);
        if (!el) return;

        const parse = this.parse;
        const taskId = recs.find(r => r.task_id)?.task_id || '';
        const cost = recs.reduce((a, r) => a + (r.agent_cost || 0) + (r.benchmark_cost || 0), 0);

        // Pre-build the visible steps so the summary count matches what we draw.
        const steps: string[] = [];
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i];
            if (r.event !== 'action') continue; // observations attach to their action below
            const a = r.action || {};
            const args = parseArgs(a.arguments);
            const obs = recs[i + 1] && recs[i + 1].event === 'observation' ? recs[i + 1].observation : undefined;
            const out = obs && obs.result != null ? formatResult(obs.result) : null;

            let inner = '';
            if (a.name === 'message') {
                const content = String(args.content ?? '');
                if (!content.trim()) continue; // skip empty agent messages
                inner = textBox(content, parse);
            } else if (a.name === 'bash') {
                inner = toolCard('bash', String(args.command ?? ''), out, out === null ? 'in-only' : '', parse, 'bash');
            } else {
                const argText = a.arguments == null ? ''
                    : typeof a.arguments === 'string' ? a.arguments
                    : JSON.stringify(a.arguments, null, 2);
                if (!a.name && !argText && out === null) continue; // nothing to show
                inner = toolCard(`🔧 ${a.name || 'tool'}`, argText, out, out === null ? 'in-only' : '', parse, 'json');
            }

            const div = `<div class="step-div"><span>Step ${steps.length + 1}${a.name ? ' · ' + escapeHtml(a.name) : ''}</span></div>`;
            steps.push(div + msgRow('assistant', '🤖 Assistant', inner));
        }

        const html = `<div class="session-summary">
            ${statusPill(sessionGrade(recs))}
            ${taskId ? `<span class="pill">${escapeHtml(taskId)}</span>` : ''}
            <span>${steps.length} step${steps.length === 1 ? '' : 's'}</span>
            ${cost ? `<span>$${cost.toFixed(4)} cost</span>` : ''}
        </div><div class="chat">${steps.join('')}</div>`;
        el.innerHTML = html;
    }

    // ---- Multi-instance view (each record is a separate task): keep tabs ----

    renderNav(dumpIdx: number, requests: Request[]): void {
        const nav = document.getElementById(`nav-${dumpIdx}`);
        if (!nav) return;

        nav.innerHTML = requests.map((req, i) => {
            const r = getResolvedStatus(req);
            const mark = r === null ? '' : r ? '🟢' : '🔴';
            const cls = r === null ? '' : r ? 'pass' : 'fail';
            return `<button class="req-btn ${cls} ${i === 0 ? 'active' : ''}" onclick="window.app.selectRequest(${i}, ${dumpIdx})">${mark} R${i + 1}</button>`;
        }).join('');
    }

    renderRequest(dumpIdx: number, reqIdx: number, req: Request | undefined): void {
        const contentEl = document.getElementById(`content-${dumpIdx}`);
        if (!contentEl || !req) return;

        const parse = this.parse;
        const taskId = req.task_id || req.instance_id || '';
        let html = `<div class="session-summary">${statusPill(req)}${taskId ? `<span class="pill">${escapeHtml(taskId)}</span>` : ''}</div>`;
        html += '<div class="chat">';
        if (req.messages && Array.isArray(req.messages)) {
            req.messages.forEach(msg => {
                const role = msg.role || 'unknown';
                const label = role === 'user' ? '👤 User' : role === 'assistant' ? '🤖 Assistant' : '⚙ ' + role;
                const content = typeof msg.content === 'string' ? msg.content : '';
                if (role === 'system') {
                    html += sysBlock(content);
                } else {
                    html += msgRow(role, label, textBox(content, parse));
                }
            });
        } else if (req.prompt) {
            html += msgRow('user', '👤 Input', textBox(req.prompt, parse));
        }
        if (req.response) {
            const r = typeof req.response === 'string' ? req.response : JSON.stringify(req.response, null, 2);
            html += msgRow('assistant', '🤖 Response', textBox(r, parse));
        }
        html += '</div>';

        const resolved = getResolvedStatus(req);
        if (resolved !== null) {
            html += `<div class="status-badge" style="border-left: 3px solid ${getStatusColor(resolved)};"><strong>${getStatusText(resolved)}</strong></div>`;
        }
        contentEl.innerHTML = html;
    }

    editDumpName(idx: number, dumps: Dump[]): void {
        const titleEl = document.getElementById(`title-${idx}`);
        if (!titleEl) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = dumps[idx].name;
        input.onblur = () => {
            dumps[idx].name = input.value || `Dump ${idx + 1}`;
            this.renderDumps(dumps);
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') input.blur();
        };
        titleEl.replaceWith(input);
        input.focus();
        input.select();
    }

    canAddDump(dumpCount: number): boolean {
        return dumpCount < this.maxDumps;
    }

    on(event: string, callback: Function): void {
        this.callbacks.set(event, callback);
    }
}

// ---------- helpers ----------

function isSession(requests: Request[]): boolean {
    return requests.length > 0 && requests.every(r => r._session === true);
}

/**
 * Rebuild one linear conversation out of the per-call trace. Each call resends
 * the whole transcript so far; we emit only the NEW context per call (skipping
 * the folded copies of earlier assistant replies, which we already show as
 * steps) and attach each call's own response as that step's action.
 */
function reconstructEvents(requests: Request[]): Event[] {
    const events: Event[] = [];
    let shown: Msg[] = [];

    requests.forEach((req, i) => {
        const msgs: Msg[] = (req.messages as Msg[]) || [];
        const common = commonPrefixLen(shown, msgs);
        const fresh = msgs.slice(common);

        for (const m of fresh) {
            if (m.role === 'assistant') continue; // already emitted as a prior step
            if (m.role === 'system') events.push({ kind: 'system', text: m.content });
            else if (isToolResult(m.content)) events.push({ kind: 'observation', text: m.content });
            else events.push({ kind: 'user', text: m.content });
        }

        const action = typeof req.response === 'string' ? req.response : JSON.stringify(req.response);
        const tokens = req.prompt_tokens != null
            ? `${fmt(req.prompt_tokens)}→${fmt(req.completion_tokens || 0)} tok`
            : '';
        events.push({ kind: 'step', label: `R${i + 1}`, tokens, action: action || '', rawChoice: req._rawChoice || '' });

        shown = msgs;
    });

    return events;
}

function commonPrefixLen(a: Msg[], b: Msg[]): number {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i].role === b[i].role && a[i].content === b[i].content) i++;
    return i;
}

function isToolResult(text: string): boolean {
    return /^Call id:/.test(text) || /\bObservation:/.test(text) || /Code execution (failed|succeeded)/.test(text);
}

/** smolagents replies are JSON like {"thought": "...", "code": "..."}. */
function parseAction(text: string): { thought: string; code: string } {
    try {
        const o = JSON.parse(text);
        if (o && (typeof o.thought === 'string' || typeof o.code === 'string')) {
            return { thought: o.thought || '', code: o.code || '' };
        }
    } catch { /* not JSON; fall through */ }
    return { thought: '', code: '' };
}

/** Default rendering of a model step: smolagents thought + code, else text. */
function renderSmolStep(actionText: string, out: string | null, parse: boolean): string {
    const action = parseAction(actionText);
    let inner = '';
    if (action.thought) inner += textBox(action.thought, parse);
    if (action.code) inner += toolCard('Code', action.code, out, out === null ? 'in-only' : '', parse);
    if (!action.thought && !action.code) {
        inner += textBox(actionText, parse);
        if (out != null) inner += toolCard('Output', '', out, 'out-only', parse);
    }
    return inner;
}

/** "Parse API" rendering: turn a raw litellm Choices() repr into tool cards. */
function renderApiStep(rawChoice: string, actionText: string, out: string | null, parse: boolean): string {
    const parsed = parseChoiceRepr(rawChoice);
    let inner = '';

    // Content may itself be a smolagents thought/code action.
    if (parsed.content) inner += renderSmolStep(parsed.content, parsed.toolCalls.length ? null : out, parse);

    parsed.toolCalls.forEach((tc, idx) => {
        const isLast = idx === parsed.toolCalls.length - 1;
        const cardOut = isLast ? out : null;
        inner += toolCard(`🔧 ${tc.name || 'tool'}`, tc.arguments, cardOut, cardOut === null ? 'in-only' : '', parse, 'json');
    });

    if (parsed.finishReason) {
        inner += `<div class="finish-tag">finish_reason: ${escapeHtml(parsed.finishReason)}</div>`;
    }
    if (!parsed.content && !parsed.toolCalls.length) {
        // Could not parse anything meaningful; fall back to the default view.
        inner = renderSmolStep(actionText, out, parse);
    }
    return inner;
}

function msgRow(role: string, label: string, innerHtml: string): string {
    return `<div class="msg ${role}">
        <div class="msg-rail"><span class="dot"></span></div>
        <div class="msg-body"><div class="msg-role">${label}</div>${innerHtml}</div>
    </div>`;
}

/** Pick the record that carries a resolved/success grade (if any) for the pill. */
function sessionGrade(reqs: Request[]): Request {
    for (const r of reqs) {
        if (r.resolved !== undefined || r.success !== undefined || r.test_result !== undefined) return r;
    }
    return {};
}

/** Render a trajectory observation result (usually {output, returncode}). */
function formatResult(result: unknown): string {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
        const o = result as { output?: unknown; returncode?: unknown };
        if (typeof o.output === 'string') {
            return o.returncode != null ? `${o.output}\n[exit ${o.returncode}]` : o.output;
        }
        return JSON.stringify(result, null, 2);
    }
    return String(result);
}

/** Tool-call arguments may be a JSON string or an object. */
function parseArgs(a: unknown): Record<string, unknown> {
    if (a == null) return {};
    if (typeof a === 'object') return a as Record<string, unknown>;
    if (typeof a === 'string') { try { return JSON.parse(a); } catch { return { _raw: a }; } }
    return {};
}

/** A text block: markdown-rendered when parse is on, plain pre-wrap otherwise. */
function textBox(text: string, parse: boolean): string {
    if (!text) return '';
    return parse
        ? `<div class="md">${renderMarkdown(text)}</div>`
        : `<div class="msg-text">${escapeHtml(text)}</div>`;
}

/** Collapsible system prompt card (always preformatted to keep its layout). */
function sysBlock(text: string): string {
    return `<details class="sys-block"><summary>⚙ System prompt · ${fmt(text.length)} chars</summary><pre class="code">${escapeHtml(text)}</pre></details>`;
}

function toolCard(head: string, inText: unknown, outText: string | null, mod: string, parse: boolean, lang = 'python'): string {
    const inStr = inText == null ? '' : String(inText);
    const inHtml = parse ? highlightCode(inStr, lang) : escapeHtml(inStr);
    let html = `<div class="tool-card ${mod}"><div class="tool-head">${escapeHtml(head)}</div>`;
    if (inStr) html += `<div class="tool-io in"><span class="io-tag">IN</span><pre class="code">${inHtml}</pre></div>`;
    if (outText != null) html += `<div class="tool-io out"><span class="io-tag">OUT</span><pre class="code">${escapeHtml(outText)}</pre></div>`;
    html += '</div>';
    return html;
}

function sum(xs: Array<number | undefined>): number {
    return xs.reduce((a: number, b) => a + (b || 0), 0);
}

function fmt(n: number): string {
    return n.toLocaleString('en-US');
}
