import { ThemeManager } from './theme.js';
import { FileHandler } from './fileHandling.js';
import { UI, Dump } from './ui.js';
import { Request } from './utils.js';
import { LibraryStore, Sidebar, LibUpload } from './library.js';
import { alertModal } from './modal.js';
import { encodeShare, decodeShare } from './share.js';

declare global {
    interface Window {
        app: App;
    }
}

class App {
    private maxDumps: number = 4;
    private dumps: Dump[] = [];
    private currentRequest: number = 0;
    private themeManager: ThemeManager;
    fileHandler: FileHandler;
    private ui: UI;
    private library: LibraryStore;
    private sidebar: Sidebar;

    constructor() {
        this.themeManager = new ThemeManager('themeToggle');
        this.fileHandler = new FileHandler('fileInput');
        this.ui = new UI('dumpsContainer', this.maxDumps);
        this.library = new LibraryStore();
        this.sidebar = new Sidebar('sidebar', this.library, (upload) => this.openUpload(upload));

        this.init();
    }

    private init(): void {
        this.fileHandler.setupListeners();
        this.fileHandler.on('onFileLoaded', (idx: number, requests: Request[], fileName: string, rawText: string) => {
            this.onFileLoaded(idx, requests, fileName, rawText);
        });

        // Stop the browser from navigating away when a file is dropped outside a panel.
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => e.preventDefault());

        this.sidebar.render();
        // A shared link (#t=...) takes over; otherwise start with one empty panel.
        this.loadFromHash().then(loaded => { if (!loaded) this.setupInitialDump(); });
    }

    /** Encode the loaded dumps into a #t= link, copy it, and reflect it in the URL. */
    async share(): Promise<void> {
        const dumps = this.dumps
            .filter(d => d.requests.length > 0 && d.raw)
            .map(d => ({ n: d.name, c: d.raw as string }));
        if (!dumps.length) {
            alertModal('Load a trace first, then share.', 'Nothing to share');
            return;
        }
        const token = await encodeShare({ v: 1, dumps });
        const url = `${location.origin}${location.pathname}#t=${token}`;
        let copied = false;
        try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard blocked */ }
        history.replaceState(null, '', url);
        const kb = Math.round(url.length / 1024);
        const longNote = url.length > 8000
            ? '\n\n⚠ This link is long; some chat apps may truncate it. For very large traces a short-link backend would be more reliable.'
            : '';
        alertModal(`${copied ? 'Link copied to clipboard' : 'Share link (copy from the address bar)'} (${kb} KB).${longNote}`, 'Share link');
    }

    private async loadFromHash(): Promise<boolean> {
        const m = location.hash.match(/[#&]t=([^&]+)/);
        if (!m) return false;
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
        } catch (e) {
            alertModal(`Could not load shared trace: ${e instanceof Error ? e.message : String(e)}`, 'Share');
        }
        return false;
    }

    /** Reset the comparison area back to a single empty panel (the home view). */
    goHome(): void {
        this.dumps = [];
        this.currentRequest = 0;
        this.addDump();
    }

    toggleParse(): void {
        const on = !this.ui.getParse();
        this.ui.setParse(on);
        const btn = document.getElementById('parseToggle');
        if (btn) { btn.textContent = on ? '✨ Parsed' : '🅰 Raw'; btn.classList.toggle('off', !on); }
        this.render();
    }

    toggleParseApi(): void {
        const on = !this.ui.getParseApi();
        this.ui.setParseApi(on);
        const btn = document.getElementById('parseApiToggle');
        if (btn) { btn.textContent = on ? '🧩 API parsed' : '🧩 Parse API'; btn.classList.toggle('off', !on); }
        this.render();
    }

    private setupInitialDump(): void {
        this.addDump();
    }

    addDump(): void {
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

    removeDump(idx: number): void {
        this.dumps.splice(idx, 1);
        this.render();
    }

    editName(idx: number): void {
        this.ui.editDumpName(idx, this.dumps);
    }

    selectRequest(idx: number, dumpIdx: number): void {
        this.currentRequest = idx;
        const buttons = document.querySelectorAll(`#nav-${dumpIdx} .req-btn`);
        buttons.forEach((btn, i) => {
            btn.classList.toggle('active', i === idx);
        });
        this.ui.renderRequest(dumpIdx, idx, this.dumps[dumpIdx].requests[idx]);
    }

    private onFileLoaded(idx: number, requests: Request[], fileName: string, rawText: string): void {
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
    private openUpload(upload: LibUpload): void {
        let idx = this.dumps.findIndex(d => d.requests.length === 0);
        if (idx === -1) {
            if (this.dumps.length < this.maxDumps) {
                idx = this.dumps.length;
                this.dumps.push({ name: `Dump ${idx + 1}`, data: null, requests: [] });
            } else {
                idx = this.dumps.length - 1;
            }
        }

        try {
            this.dumps[idx].requests = this.fileHandler.parseText(upload.content);
            this.dumps[idx].raw = upload.content;
            this.dumps[idx].name = upload.name.replace(/\.[^/.]+$/, '');
        } catch (e) {
            alertModal(`Could not open ${upload.name}: ${e instanceof Error ? e.message : String(e)}`, 'Open failed');
            return;
        }
        this.render();
    }

    private render(): void {
        this.ui.renderDumps(this.dumps);
        // Wire each panel's drop zone so dropping a file actually loads it.
        this.dumps.forEach((_, idx) => this.fileHandler.setupDropZone(idx, `dropZone-${idx}`));
    }
}

window.app = new App();
