export class FileHandler {
    constructor(fileInputId) {
        this.fileInput = document.getElementById(fileInputId);
        this.callbacks = {};
    }

    setupListeners() {
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const idx = parseInt(e.target.dataset.target);
                this.handleFile(e.target.files[0], idx);
            }
        });
    }

    setupDropZone(idx, dropZoneId) {
        const dropZone = document.getElementById(dropZoneId);
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (e) => this.handleDragOver(e, dropZoneId));
        dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e, dropZoneId));
        dropZone.addEventListener('drop', (e) => this.handleDrop(e, idx, dropZoneId));
    }

    handleDragOver(e, dropZoneId) {
        e.preventDefault();
        document.getElementById(dropZoneId).classList.add('dragover');
    }

    handleDragLeave(e, dropZoneId) {
        document.getElementById(dropZoneId).classList.remove('dragover');
    }

    async handleDrop(e, idx, dropZoneId) {
        e.preventDefault();
        document.getElementById(dropZoneId).classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            await this.handleFile(e.dataTransfer.files[0], idx);
        }
    }

    async handleFile(file, idx) {
        try {
            const text = await file.text();
            const parsed = this.parseFile(text);

            if (this.callbacks.onFileLoaded) {
                this.callbacks.onFileLoaded(idx, parsed, file.name);
            }
        } catch (error) {
            alert(`Error loading file: ${error.message}`);
        }
    }

    parseFile(text) {
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

    triggerFileInput(idx) {
        this.fileInput.dataset.target = idx;
        this.fileInput.click();
    }

    on(event, callback) {
        this.callbacks[event] = callback;
    }
}
