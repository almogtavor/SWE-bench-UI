import { Request } from './utils.js';
import { alertModal } from './modal.js';

export type FileCallback = (idx: number, requests: Request[], fileName: string, rawText: string) => void;

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
                callback(idx, parsed, file.name, text);
            }
        } catch (error) {
            alertModal(`Error loading file: ${error instanceof Error ? error.message : String(error)}`, 'Load error');
        }
    }

    /** Parse raw JSON/JSONL text into renderable requests (used for re-opening saved uploads too). */
    parseText(text: string): Request[] {
        return this.parseFile(text);
    }

    private parseFile(text: string): Request[] {
        const trimmed = text.trim();
        const raw = this.extractRecords(trimmed);
        // Normalize every record so litellm trace.jsonl lines (request/response
        // shaped) render the same way as flat SWE bench records.
        return raw.map(normalizeRecord);
    }

    private extractRecords(trimmed: string): any[] {
        return extractRecords(trimmed);
    }

    triggerFileInput(idx: number): void {
        this.fileInput.dataset.target = String(idx);
        this.fileInput.click();
    }

    on(event: string, callback: FileCallback): void {
        this.callbacks.set(event, callback);
    }
}

/**
 * Split raw JSON/JSONL text into records: a single JSON value, a JSON array,
 * a baseline/spans/requests wrapper, or one JSON value per line (JSONL).
 */
export function extractRecords(trimmed: string): any[] {
    // Try the whole text as one JSON value (covers pretty-printed exports and
    // the baseline/spans wrappers). Runs first because a JSONL file of objects
    // also starts with '{' but is NOT one parseable JSON value.
    const whole = tryParse(trimmed);
    if (whole !== undefined) {
        if (whole && whole.baseline && whole.baseline.requests) return whole.baseline.requests;
        if (whole && whole.spans && whole.spans.requests) return whole.spans.requests;
        if (whole && whole.requests && Array.isArray(whole.requests)) return whole.requests;
        if (Array.isArray(whole)) return whole;
        return [whole];
    }

    // Otherwise treat it as JSONL: one JSON value per line.
    const lines = trimmed.split('\n').filter(line => line.trim());
    const records: any[] = [];
    for (const line of lines) {
        const obj = tryParse(line);
        if (obj !== undefined) records.push(obj);
        else console.warn('Failed to parse JSONL line:', line);
    }
    return records;
}

/** JSON.parse that returns undefined instead of throwing on invalid input. */
function tryParse(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/**
 * A litellm trace.jsonl line is one LLM call: { request: { messages }, response:
 * { choices }, prompt_tokens, completion_tokens, ... }. The viewer expects flat
 * Request objects with top-level `messages`/`response`, so convert when we see
 * that shape and leave any other record untouched.
 */
function normalizeRecord(obj: any): Request {
    // Trajectory event log: alternating action / observation records.
    const isTrajectory = obj && typeof obj === 'object'
        && (obj.event === 'action' || obj.event === 'observation')
        && ('action' in obj || 'observation' in obj);
    if (isTrajectory) {
        return { ...obj, _session: true, _kind: 'trajectory' };
    }

    const isLiteLLMTrace = obj && typeof obj === 'object'
        && obj.request && Array.isArray(obj.request.messages)
        && (obj.response !== undefined || obj.trace_id !== undefined);

    if (!isLiteLLMTrace) {
        return obj as Request;
    }

    const messages = obj.request.messages.map((m: any) => ({
        role: typeof m.role === 'string' ? m.role : 'unknown',
        content: flattenContent(m.content),
    }));

    const reply = extractAssistantContent(obj.response);
    const rawChoice = obj.response && Array.isArray(obj.response.choices) && typeof obj.response.choices[0] === 'string'
        ? obj.response.choices[0]
        : '';

    return {
        ...obj,
        _session: true,
        _kind: 'litellm',
        _rawChoice: rawChoice,
        messages,
        response: reply !== '' ? reply : obj.response,
        prompt_tokens: obj.prompt_tokens,
        completion_tokens: obj.completion_tokens,
    };
}

/** Message content may be a plain string or an array of {type, text} parts. */
function flattenContent(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') return part.text ?? part.content ?? JSON.stringify(part);
                return String(part);
            })
            .join('\n');
    }
    if (content == null) return '';
    return JSON.stringify(content);
}

/**
 * Pull the assistant text out of a litellm response. Handles both a proper
 * object ({ choices: [{ message: { content } }] }) and the stringified Python
 * repr these traces store: "Choices(... message=Message(content='...', role=...))".
 */
function extractAssistantContent(response: any): string {
    if (!response) return '';
    const choices = response.choices;
    if (!Array.isArray(choices) || choices.length === 0) return '';
    const first = choices[0];

    if (first && typeof first === 'object') {
        if (first.message && typeof first.message.content === 'string') return first.message.content;
        if (typeof first.text === 'string') return first.text;
        return JSON.stringify(first);
    }

    if (typeof first === 'string') {
        const single = first.match(/content='((?:\\.|[^'\\])*)'/);
        if (single) return unescapePyStr(single[1]);
        const double = first.match(/content="((?:\\.|[^"\\])*)"/);
        if (double) return unescapePyStr(double[1]);
        return first;
    }

    return '';
}

/** Undo the escaping in a Python repr string ('\\n', "\\'", '\\\\', ...). */
function unescapePyStr(s: string): string {
    return s.replace(/\\(n|t|r|'|"|\\)/g, (_match, c) => {
        switch (c) {
            case 'n': return '\n';
            case 't': return '\t';
            case 'r': return '\r';
            default: return c; // ', ", \
        }
    });
}
