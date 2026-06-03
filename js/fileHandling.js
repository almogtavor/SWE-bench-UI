export class FileHandler {
    constructor(fileInputId) {
        this.callbacks = new Map();
        const input = document.getElementById(fileInputId);
        if (!input || !(input instanceof HTMLInputElement)) {
            throw new Error(`File input with id ${fileInputId} not found`);
        }
        this.fileInput = input;
    }
    setupListeners() {
        this.fileInput.addEventListener('change', (e) => {
            const target = e.target;
            if (target.files && target.files.length > 0) {
                const idx = parseInt(target.dataset.target || '0');
                this.handleFile(target.files[0], idx);
            }
        });
    }
    setupDropZone(idx, dropZoneId) {
        const dropZone = document.getElementById(dropZoneId);
        if (!dropZone)
            return;
        dropZone.addEventListener('dragover', (e) => this.handleDragOver(e, dropZoneId));
        dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e, dropZoneId));
        dropZone.addEventListener('drop', (e) => this.handleDrop(e, idx, dropZoneId));
    }
    handleDragOver(e, dropZoneId) {
        e.preventDefault();
        document.getElementById(dropZoneId)?.classList.add('dragover');
    }
    handleDragLeave(e, dropZoneId) {
        document.getElementById(dropZoneId)?.classList.remove('dragover');
    }
    async handleDrop(e, idx, dropZoneId) {
        e.preventDefault();
        document.getElementById(dropZoneId)?.classList.remove('dragover');
        if (e.dataTransfer?.files.length) {
            await this.handleFile(e.dataTransfer.files[0], idx);
        }
    }
    async handleFile(file, idx) {
        try {
            const text = await file.text();
            const parsed = this.parseFile(text);
            const callback = this.callbacks.get('onFileLoaded');
            if (callback) {
                callback(idx, parsed, file.name);
            }
        }
        catch (error) {
            alert(`Error loading file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    parseFile(text) {
        const trimmed = text.trim();
        if (trimmed.startsWith('[')) {
            const parsed = JSON.parse(trimmed);
            if (parsed.baseline && parsed.baseline.requests) {
                return parsed.baseline.requests;
            }
            else if (parsed.spans && parsed.spans.requests) {
                return parsed.spans.requests;
            }
            else if (parsed.requests && Array.isArray(parsed.requests)) {
                return parsed.requests;
            }
            else if (Array.isArray(parsed)) {
                return parsed;
            }
            else {
                return [parsed];
            }
        }
        else {
            const lines = trimmed.split('\n').filter(line => line.trim());
            const requests = [];
            for (const line of lines) {
                try {
                    const obj = JSON.parse(line);
                    requests.push(obj);
                }
                catch (e) {
                    console.warn('Failed to parse JSONL line:', line);
                }
            }
            return requests.length > 0 ? requests : [JSON.parse(trimmed)];
        }
    }
    triggerFileInput(idx) {
        this.fileInput.dataset.target = String(idx);
        this.fileInput.click();
    }
    on(event, callback) {
        this.callbacks.set(event, callback);
    }
}
//# sourceMappingURL=fileHandling.js.map