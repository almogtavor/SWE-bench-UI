import { ThemeManager } from './theme.js';
import { FileHandler } from './fileHandling.js';
import { UI, Dump } from './ui.js';
import { Request } from './utils.js';
import { LibraryStore, Sidebar, LibUpload } from './library.js';

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

        this.sidebar.render();
        this.setupInitialDump();
    }

    private setupInitialDump(): void {
        this.addDump();
    }

    addDump(): void {
        if (this.dumps.length >= this.maxDumps) {
            alert(`Maximum ${this.maxDumps} dumps allowed`);
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
            this.dumps[idx].name = upload.name.replace(/\.[^/.]+$/, '');
        } catch (e) {
            alert(`Could not open ${upload.name}: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }
        this.render();
    }

    private render(): void {
        this.ui.renderDumps(this.dumps);
    }
}

window.app = new App();
