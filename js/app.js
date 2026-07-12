import { ThemeManager } from './theme.js';
import { FileHandler } from './fileHandling.js';
import { UI } from './ui.js';
import { LibraryStore, Sidebar } from './library.js';
import { alertModal } from './modal.js';
import { encodeShare, decodeShare } from './share.js';
class App {
    constructor() {
        this.maxDumps = 4;
        this.dumps = [];
        this.currentRequest = 0;
        this.themeManager = new ThemeManager('themeToggle');
        this.fileHandler = new FileHandler('fileInput');
        this.ui = new UI('dumpsContainer', this.maxDumps);
        this.library = new LibraryStore();
        this.sidebar = new Sidebar('sidebar', this.library, (upload) => this.openUpload(upload));
        this.init();
    }
    init() {
        this.fileHandler.setupListeners();
        this.fileHandler.on('onFileLoaded', (idx, requests, fileName, rawText) => {
            this.onFileLoaded(idx, requests, fileName, rawText);
        });
        // Stop the browser from navigating away when a file is dropped outside a panel.
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => e.preventDefault());
        this.sidebar.render();
        // A shared link (#t=...) takes over; otherwise start with one empty panel.
        this.loadFromHash().then(loaded => { if (!loaded)
            this.setupInitialDump(); });
    }
    /** Encode the loaded dumps into a #t= link, copy it, and reflect it in the URL. */
    async share() {
        const dumps = this.dumps
            .filter(d => d.requests.length > 0 && d.raw)
            .map(d => ({ n: d.name, c: d.raw }));
        if (!dumps.length) {
            alertModal('Load a trace first, then share.', 'Nothing to share');
            return;
        }
        const token = await encodeShare({ v: 1, dumps });
        const url = `${location.origin}${location.pathname}#t=${token}`;
        let copied = false;
        try {
            await navigator.clipboard.writeText(url);
            copied = true;
        }
        catch { /* clipboard blocked */ }
        history.replaceState(null, '', url);
        const kb = Math.round(url.length / 1024);
        const longNote = url.length > 8000
            ? '\n\n⚠ This link is long; some chat apps may truncate it. For very large traces a short-link backend would be more reliable.'
            : '';
        alertModal(`${copied ? 'Link copied to clipboard' : 'Share link (copy from the address bar)'} (${kb} KB).${longNote}`, 'Share link');
    }
    async loadFromHash() {
        const m = location.hash.match(/[#&]t=([^&]+)/);
        if (!m)
            return false;
        try {
            const payload = await decodeShare(m[1]);
            const dumps = payload?.dumps;
            if (Array.isArray(dumps) && dumps.length) {
                this.dumps = dumps.map((d, i) => ({
                    name: d.n || `Dump ${i + 1}`,
                    data: null,
                    requests: this.fileHandler.parseText(d.c || ''),
                    raw: d.c || '',
                }));
                this.render();
                return true;
            }
        }
        catch (e) {
            alertModal(`Could not load shared trace: ${e instanceof Error ? e.message : String(e)}`, 'Share');
        }
        return false;
    }
    /** Reset the comparison area back to a single empty panel (the home view). */
    goHome() {
        this.dumps = [];
        this.currentRequest = 0;
        this.addDump();
    }
    toggleParse() {
        const on = !this.ui.getParse();
        this.ui.setParse(on);
        const btn = document.getElementById('parseToggle');
        if (btn) {
            btn.textContent = on ? '✨ Parsed' : '🅰 Raw';
            btn.classList.toggle('off', !on);
        }
        this.render();
    }
    toggleParseApi() {
        const on = !this.ui.getParseApi();
        this.ui.setParseApi(on);
        const btn = document.getElementById('parseApiToggle');
        if (btn) {
            btn.textContent = on ? '🧩 API parsed' : '🧩 Parse API';
            btn.classList.toggle('off', !on);
        }
        this.render();
    }
    setupInitialDump() {
        this.addDump();
    }
    addDump() {
        if (this.dumps.length >= this.maxDumps) {
            alertModal(`Maximum ${this.maxDumps} dumps allowed`, 'Limit reached');
            return;
        }
        const idx = this.dumps.length;
        this.dumps.push({
            name: `Dump ${idx + 1}`,
            data: null,
            requests: []
        });
        this.render();
    }
    removeDump(idx) {
        this.dumps.splice(idx, 1);
        this.render();
    }
    editName(idx) {
        this.ui.editDumpName(idx, this.dumps);
    }
    selectRequest(idx, dumpIdx) {
        this.currentRequest = idx;
        const buttons = document.querySelectorAll(`#nav-${dumpIdx} .req-btn`);
        buttons.forEach((btn, i) => {
            btn.classList.toggle('active', i === idx);
        });
        this.ui.renderRequest(dumpIdx, idx, this.dumps[dumpIdx].requests[idx]);
    }
    onFileLoaded(idx, requests, fileName, rawText) {
        // A dropped .swebench.json bundle is a library import, not a single trace:
        // route it to the sidebar so it becomes a comparable folder (not an "ungraded" dump).
        if (this.sidebar.importBundleText(rawText))
            return;
        this.dumps[idx].requests = requests;
        this.dumps[idx].raw = rawText;
        if (this.dumps[idx].name.startsWith('Dump')) {
            this.dumps[idx].name = fileName.replace(/\.[^/.]+$/, '');
        }
        // Remember the upload in the local library so it survives reloads.
        this.library.addUpload(fileName, rawText);
        this.sidebar.render();
        this.render();
    }
    /** Open a saved upload: reuse the first empty panel, else add one, else replace the last. */
    openUpload(upload) {
        let idx = this.dumps.findIndex(d => d.requests.length === 0);
        if (idx === -1) {
            if (this.dumps.length < this.maxDumps) {
                idx = this.dumps.length;
                this.dumps.push({ name: `Dump ${idx + 1}`, data: null, requests: [] });
            }
            else {
                idx = this.dumps.length - 1;
            }
        }
        try {
            this.dumps[idx].requests = this.fileHandler.parseText(upload.content);
            this.dumps[idx].raw = upload.content;
            this.dumps[idx].name = upload.name.replace(/\.[^/.]+$/, '');
        }
        catch (e) {
            alertModal(`Could not open ${upload.name}: ${e instanceof Error ? e.message : String(e)}`, 'Open failed');
            return;
        }
        this.render();
    }
    render() {
        this.ui.renderDumps(this.dumps);
        // Wire each panel's drop zone so dropping a file actually loads it.
        this.dumps.forEach((_, idx) => this.fileHandler.setupDropZone(idx, `dropZone-${idx}`));
    }
}
window.app = new App();
//# sourceMappingURL=app.js.map