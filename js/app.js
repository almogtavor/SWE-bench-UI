import { ThemeManager } from './theme.js';
import { FileHandler } from './fileHandling.js';
import { UI } from './ui.js';

class App {
    constructor() {
        this.maxDumps = 4;
        this.dumps = [];
        this.currentRequest = 0;

        this.themeManager = new ThemeManager('themeToggle');
        this.fileHandler = new FileHandler('fileInput');
        this.ui = new UI('dumpsContainer', this.maxDumps);

        this.init();
    }

    init() {
        this.fileHandler.setupListeners();
        this.fileHandler.on('onFileLoaded', (idx, requests, fileName) => {
            this.onFileLoaded(idx, requests, fileName);
        });

        this.setupInitialDump();
    }

    setupInitialDump() {
        this.addDump();
    }

    addDump() {
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

    onFileLoaded(idx, requests, fileName) {
        this.dumps[idx].requests = requests;
        if (this.dumps[idx].name.startsWith('Dump')) {
            this.dumps[idx].name = fileName.replace(/\.[^/.]+$/, '');
        }
        this.render();
    }

    render() {
        this.ui.renderDumps(this.dumps);
    }

    // Public method for HTML onclick handlers
    triggerFileInput(idx) {
        this.fileHandler.triggerFileInput(idx);
    }
}

window.app = new App();
