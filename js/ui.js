import { escapeHtml, getResolvedStatus, getStatusColor, getStatusText } from './utils.js';

export class UI {
    constructor(containerId, maxDumps = 4) {
        this.container = document.getElementById(containerId);
        this.maxDumps = maxDumps;
        this.callbacks = {};
    }

    renderDumps(dumps) {
        this.container.innerHTML = dumps.map((dump, idx) => `
            <div class="dump-panel">
                <div class="dump-header">
                    <div class="dump-title" id="title-${idx}" ondblclick="window.app.editName(${idx})">${escapeHtml(dump.name)}</div>
                    <button class="remove-btn" onclick="window.app.removeDump(${idx})">✕</button>
                </div>
                <div class="drop-zone" id="dropZone-${idx}" onclick="window.app.fileHandler.triggerFileInput(${idx})">
                    <div class="drop-zone-text">📁</div>
                    <div class="drop-zone-sub">Drag file or click</div>
                </div>
                ${dump.requests.length > 0 ? `
                    <div class="request-nav" id="nav-${idx}"></div>
                    <div class="dump-content" id="content-${idx}"></div>
                ` : '<div class="no-data">No data</div>'}
            </div>
        `).join('');

        dumps.forEach((dump, idx) => {
            if (dump.requests.length > 0) {
                this.renderNav(idx, dump.requests.length);
                this.renderRequest(idx, 0, dump.requests[0]);
            }
            this.setupDropZone(idx);
        });
    }

    renderNav(dumpIdx, requestCount) {
        const nav = document.getElementById(`nav-${dumpIdx}`);
        if (!nav) return;

        nav.innerHTML = Array.from({ length: requestCount }, (_, i) => `
            <button class="req-btn ${i === 0 ? 'active' : ''}" onclick="window.app.selectRequest(${i}, ${dumpIdx})">R${i + 1}</button>
        `).join('');
    }

    renderRequest(dumpIdx, reqIdx, req) {
        const contentEl = document.getElementById(`content-${dumpIdx}`);
        if (!contentEl || !req) return;

        let html = this.buildMessageBlocks(req);
        const resolved = getResolvedStatus(req);

        if (resolved !== null) {
            html += `<div class="message-block" style="border-left: 3px solid ${getStatusColor(resolved)};"><strong>${getStatusText(resolved)}</strong></div>`;
        }

        contentEl.innerHTML = html;
    }

    buildMessageBlocks(req) {
        let html = '';

        if (req.messages && Array.isArray(req.messages)) {
            req.messages.forEach(msg => {
                const role = msg.role || 'unknown';
                const icon = role === 'user' ? '👤' : role === 'assistant' ? '🤖' : '💬';
                html += `
                    <div class="message-block">
                        <div class="message-role">${icon} ${role.toUpperCase()}</div>
                        <div>${escapeHtml((typeof msg.content === 'string' ? msg.content : '').substring(0, 300))}</div>
                    </div>
                `;
            });
        } else if (req.prompt) {
            html += `
                <div class="message-block">
                    <div class="message-role">👤 Input</div>
                    <div>${escapeHtml(req.prompt.substring(0, 300))}</div>
                </div>
            `;
        }

        if (req.response) {
            html += `
                <div class="message-block">
                    <div class="message-role">🤖 Response</div>
                    <div>${escapeHtml(typeof req.response === 'string' ? req.response : JSON.stringify(req.response).substring(0, 300))}</div>
                </div>
            `;
        }

        if (req.prompt_tokens !== undefined || req.latency_seconds !== undefined || req.completion_tokens !== undefined) {
            html += `
                <div class="message-block">
                    <div class="message-role">📊 Metrics</div>
                    <div>Input: ${req.prompt_tokens || 0} | Output: ${req.completion_tokens || 0} | Latency: ${req.latency_seconds ? req.latency_seconds.toFixed(2) + 's' : 'N/A'}</div>
                </div>
            `;
        }

        return html;
    }

    setupDropZone(idx) {
        const dropZone = document.getElementById(`dropZone-${idx}`);
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (e) => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (this.callbacks.onDrop) {
                this.callbacks.onDrop(e, idx);
            }
        });
    }

    editDumpName(idx, dumps) {
        const titleEl = document.getElementById(`title-${idx}`);
        if (!titleEl) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = dumps[idx].name;
        input.onblur = () => {
            dumps[idx].name = input.value || `Dump ${idx + 1}`;
            this.renderDumps(dumps);
            if (this.callbacks.onNameChange) {
                this.callbacks.onNameChange();
            }
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') input.blur();
        };
        titleEl.replaceWith(input);
        input.focus();
        input.select();
    }

    canAddDump(dumpCount) {
        return dumpCount < this.maxDumps;
    }

    on(event, callback) {
        this.callbacks[event] = callback;
    }
}
