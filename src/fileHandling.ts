import { Request } from './utils.js';

export type FileCallback = (idx: number, requests: Request[], fileName: string) => void;

export class FileHandler {
    private fileInput: HTMLInputElement;
    private callbacks: Map<string, FileCallback> = new Map();

    constructor(fileInputId: string) {
        const input = document.getElementById(fileInputId);
        if (!input || !(input instanceof HTMLInputElement)) {
            throw new Error(`File input with id ${fileInputId} not found`);
        }
        this.fileInput = input;
    }

    setupListeners(): void {
        this.fileInput.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                const idx = parseInt(target.dataset.target || '0');
                this.handleFile(target.files[0], idx);
            }
        });
    }

    setupDropZone(idx: number, dropZoneId: string): void {
        const dropZone = document.getElementById(dropZoneId);
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (e) => this.handleDragOver(e, dropZoneId));
        dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e, dropZoneId));
        dropZone.addEventListener('drop', (e) => this.handleDrop(e, idx, dropZoneId));
    }

    private handleDragOver(e: DragEvent, dropZoneId: string): void {
        e.preventDefault();
        document.getElementById(dropZoneId)?.classList.add('dragover');
    }

    private handleDragLeave(e: DragEvent, dropZoneId: string): void {
        document.getElementById(dropZoneId)?.classList.remove('dragover');
    }

    async handleDrop(e: DragEvent, idx: number, dropZoneId: string): Promise<void> {
        e.preventDefault();
        document.getElementById(dropZoneId)?.classList.remove('dragover');
        if (e.dataTransfer?.files.length) {
            await this.handleFile(e.dataTransfer.files[0], idx);
        }
    }

    async handleFile(file: File, idx: number): Promise<void> {
        try {
            const text = await file.text();
            const parsed = this.parseFile(text);

            const callback = this.callbacks.get('onFileLoaded');
            if (callback) {
                callback(idx, parsed, file.name);
            }
        } catch (error) {
            alert(`Error loading file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private parseFile(text: string): Request[] {
        const parsed = JSON.parse(text);

        if (parsed.baseline && parsed.baseline.requests) {
            return parsed.baseline.requests;
        } else if (parsed.spans && parsed.spans.requests) {
            return parsed.spans.requests;
        } else if (parsed.requests && Array.isArray(parsed.requests)) {
            return parsed.requests;
        } else if (Array.isArray(parsed)) {
            return parsed;
        } else {
            return [parsed];
        }
    }

    triggerFileInput(idx: number): void {
        this.fileInput.dataset.target = String(idx);
        this.fileInput.click();
    }

    on(event: string, callback: FileCallback): void {
        this.callbacks.set(event, callback);
    }
}
