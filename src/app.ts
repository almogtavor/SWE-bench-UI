import { ThemeManager } from './theme.js';
import { FileHandler } from './fileHandling.js';
import { UI, Dump } from './ui.js';
import { Request } from './utils.js';

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

    constructor() {
        this.themeManager = new ThemeManager('themeToggle');
        this.fileHandler = new FileHandler('fileInput');
        this.ui = new UI('dumpsContainer', this.maxDumps);

        this.init();
    }

    private init(): void {
        this.fileHandler.setupListeners();
        this.fileHandler.on('onFileLoaded', (idx: number, requests: Request[], fileName: string) => {
            this.onFileLoaded(idx, requests, fileName);
        });

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

    private onFileLoaded(idx: number, requests: Request[], fileName: string): void {
        this.dumps[idx].requests = requests;
        if (this.dumps[idx].name.startsWith('Dump')) {
            this.dumps[idx].name = fileName.replace(/\.[^/.]+$/, '');
        }
        this.render();
    }

    private render(): void {
        this.ui.renderDumps(this.dumps);
    }
}

window.app = new App();
