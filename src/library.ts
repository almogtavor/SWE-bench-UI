// Local, browser-only library of past uploads. Everything lives in
// localStorage so a user's traces and the folders they organise them into
// survive page reloads without any backend.

import { confirmModal, promptModal, alertModal } from './modal.js';
import { gradeContent, Grade } from './grade.js';
import { openSweepOverlay } from './sweep.js';

export interface LibFolder {
    id: string;
    name: string;
    parentId: string | null;
}

export interface LibUpload {
    id: string;
    name: string;
    content: string;
    uploadedAt: number;
    folderId: string | null;
}

interface LibraryData {
    folders: LibFolder[];
    uploads: LibUpload[];
}

export interface LibraryBundle {
    swebench_ui_bundle: number;
    exported_at: number;
    name: string;
    folders: LibFolder[];
    uploads: Array<{ name: string; content: string; folderId: string | null; uploadedAt: number }>;
}

const STORAGE_KEY = 'swebench-ui-library';

function newId(): string {
    const c = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export class LibraryStore {
    private data: LibraryData = { folders: [], uploads: [] };

    constructor() {
        this.load();
    }

    private load(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.data = {
                    folders: Array.isArray(parsed.folders) ? parsed.folders : [],
                    uploads: Array.isArray(parsed.uploads) ? parsed.uploads : [],
                };
            }
        } catch {
            this.data = { folders: [], uploads: [] };
        }
    }

    private save(): boolean {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
            return true;
        } catch (e) {
            alertModal('Could not save to local storage (it may be full). Delete some uploads and try again.', 'Storage full');
            return false;
        }
    }

    /** Persist an upload. Identical name+content just bumps the timestamp. */
    addUpload(name: string, content: string, folderId: string | null = null): LibUpload {
        const existing = this.data.uploads.find(u => u.name === name && u.content === content);
        if (existing) {
            existing.uploadedAt = Date.now();
            this.save();
            return existing;
        }
        const upload: LibUpload = { id: newId(), name, content, uploadedAt: Date.now(), folderId };
        this.data.uploads.push(upload);
        this.save();
        return upload;
    }

    createFolder(name: string, parentId: string | null = null): LibFolder {
        const folder: LibFolder = { id: newId(), name, parentId };
        this.data.folders.push(folder);
        this.save();
        return folder;
    }

    renameFolder(id: string, name: string): void {
        const f = this.data.folders.find(f => f.id === id);
        if (f) { f.name = name; this.save(); }
    }

    renameUpload(id: string, name: string): void {
        const u = this.data.uploads.find(u => u.id === id);
        if (u) { u.name = name; this.save(); }
    }

    deleteUpload(id: string): void {
        this.data.uploads = this.data.uploads.filter(u => u.id !== id);
        this.save();
    }

    /** Delete a folder and everything inside it, recursively. */
    deleteFolder(id: string): void {
        const toRemove = new Set<string>();
        const collect = (fid: string) => {
            toRemove.add(fid);
            this.data.folders.filter(f => f.parentId === fid).forEach(c => collect(c.id));
        };
        collect(id);
        this.data.folders = this.data.folders.filter(f => !toRemove.has(f.id));
        this.data.uploads = this.data.uploads.filter(u => !(u.folderId && toRemove.has(u.folderId)));
        this.save();
    }

    moveUpload(id: string, folderId: string | null): void {
        const u = this.data.uploads.find(u => u.id === id);
        if (u) { u.folderId = folderId; this.save(); }
    }

    /** Move a folder, refusing moves that would create a cycle. */
    moveFolder(id: string, parentId: string | null): void {
        if (id === parentId) return;
        if (parentId && this.isDescendant(parentId, id)) return;
        const f = this.data.folders.find(f => f.id === id);
        if (f) { f.parentId = parentId; this.save(); }
    }

    private isDescendant(candidateId: string, ancestorId: string): boolean {
        let current = this.data.folders.find(f => f.id === candidateId);
        while (current && current.parentId) {
            if (current.parentId === ancestorId) return true;
            current = this.data.folders.find(f => f.id === current!.parentId);
        }
        return false;
    }

    foldersIn(parentId: string | null): LibFolder[] {
        return this.data.folders
            .filter(f => f.parentId === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    uploadsIn(folderId: string | null): LibUpload[] {
        return this.data.uploads
            .filter(u => u.folderId === folderId)
            .sort((a, b) => b.uploadedAt - a.uploadedAt);
    }

    getUpload(id: string): LibUpload | undefined {
        return this.data.uploads.find(u => u.id === id);
    }

    /** Bundle a folder and its descendants into a portable object (re-rooted). */
    exportFolder(folderId: string): LibraryBundle {
        const ids = new Set<string>();
        const collect = (fid: string) => {
            ids.add(fid);
            this.data.folders.filter(f => f.parentId === fid).forEach(c => collect(c.id));
        };
        collect(folderId);
        const name = this.data.folders.find(f => f.id === folderId)?.name || 'folder';
        const folders = this.data.folders
            .filter(f => ids.has(f.id) && f.id !== folderId)
            .map(f => ({ id: f.id, name: f.name, parentId: f.parentId === folderId ? null : f.parentId }));
        const uploads = this.data.uploads
            .filter(u => u.folderId && ids.has(u.folderId))
            .map(u => ({ name: u.name, content: u.content, uploadedAt: u.uploadedAt, folderId: u.folderId === folderId ? null : u.folderId }));
        return { swebench_ui_bundle: 1, exported_at: Date.now(), name, folders, uploads };
    }

    /** Bundle the entire library. */
    exportAll(): LibraryBundle {
        return {
            swebench_ui_bundle: 1,
            exported_at: Date.now(),
            name: 'Library',
            folders: this.data.folders.map(f => ({ ...f })),
            uploads: this.data.uploads.map(u => ({ name: u.name, content: u.content, uploadedAt: u.uploadedAt, folderId: u.folderId })),
        };
    }

    /** Recreate a bundle under a fresh wrapper folder, remapping all ids. */
    importBundle(bundle: LibraryBundle): { folders: number; uploads: number; rootId: string } {
        if (!bundle || bundle.swebench_ui_bundle == null || !Array.isArray(bundle.uploads)) {
            throw new Error('Not a SWE-bench-UI bundle');
        }
        const rootId = newId();
        this.data.folders.push({ id: rootId, name: bundle.name || 'Imported', parentId: null });

        const idMap = new Map<string, string>();
        (bundle.folders || []).forEach(f => idMap.set(f.id, newId()));
        (bundle.folders || []).forEach(f => {
            const parent = f.parentId == null ? rootId : (idMap.get(f.parentId) || rootId);
            this.data.folders.push({ id: idMap.get(f.id)!, name: f.name, parentId: parent });
        });
        bundle.uploads.forEach(u => {
            const folderId = u.folderId ? (idMap.get(u.folderId) || rootId) : rootId;
            this.data.uploads.push({ id: newId(), name: u.name, content: u.content, uploadedAt: u.uploadedAt || Date.now(), folderId });
        });
        this.save();
        return { folders: (bundle.folders || []).length, uploads: bundle.uploads.length, rootId };
    }
}

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
}

function esc(text: string): string {
    return text.replace(/[&<>"']/g, m =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m] as string));
}

/** "3/12" resolved badge; empty when nothing in the file is graded. */
function gradeBadge(g: Grade): string {
    if (g.total === 0) return '';
    const cls = g.resolved === g.total ? 'all' : g.resolved === 0 ? 'none' : 'some';
    return `<span class="tree-grade ${cls}" title="${g.resolved} of ${g.total} tasks resolved">${g.resolved}/${g.total}</span>`;
}

function downloadBundle(bundle: unknown, baseName: string): void {
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName.replace(/[^\w.-]+/g, '_')}.swebench.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export type OpenUploadCallback = (upload: LibUpload) => void;

export class Sidebar {
    private container: HTMLElement;
    private store: LibraryStore;
    private onOpen: OpenUploadCallback;
    private expanded = new Set<string>();
    private collapsed = false;

    constructor(containerId: string, store: LibraryStore, onOpen: OpenUploadCallback) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Sidebar container ${containerId} not found`);
        this.container = el;
        this.store = store;
        this.onOpen = onOpen;
    }

    render(): void {
        if (this.collapsed) {
            this.container.classList.add('collapsed');
            this.container.innerHTML = `
                <button class="sidebar-expand" title="Show library">📁</button>`;
            this.container.querySelector('.sidebar-expand')
                ?.addEventListener('click', () => this.toggle());
            return;
        }

        this.container.classList.remove('collapsed');
        this.container.innerHTML = `
            <div class="sidebar-header">
                <span class="sidebar-title">📚 Library</span>
                <div class="sidebar-actions">
                    <button class="sidebar-btn" data-act="new-root-folder" title="New folder">＋📁</button>
                    <button class="sidebar-btn" data-act="import" title="Import a bundle file">📥</button>
                    <button class="sidebar-btn" data-act="export-all" title="Export the whole library">📤</button>
                    <button class="sidebar-btn" data-act="collapse" title="Hide library">⟨</button>
                </div>
            </div>
            <div class="sidebar-tree" id="sidebarTree"></div>`;

        const tree = this.container.querySelector('#sidebarTree') as HTMLElement;
        tree.innerHTML = this.renderChildren(null, 0);
        this.wire(tree);
    }

    private renderChildren(parentId: string | null, depth: number): string {
        const folders = this.store.foldersIn(parentId);
        const uploads = this.store.uploadsIn(parentId);

        if (depth === 0 && folders.length === 0 && uploads.length === 0) {
            return `<div class="sidebar-empty">No uploads yet.<br>Drop a file in a panel to save it here.</div>`;
        }

        const pad = (d: number) => `padding-left:${8 + d * 14}px`;
        let html = '';

        for (const f of folders) {
            const open = this.expanded.has(f.id);
            html += `
                <div class="tree-row tree-folder" data-kind="folder" data-id="${f.id}" draggable="true" style="${pad(depth)}">
                    <span class="tree-twisty" data-act="toggle">${open ? '▾' : '▸'}</span>
                    <span class="tree-icon">${open ? '📂' : '📁'}</span>
                    <span class="tree-name" data-act="rename" title="Double-click to rename">${esc(f.name)}</span>
                    ${gradeBadge(this.gradeFolder(f.id))}
                    <span class="tree-row-actions">
                        <button class="tree-act" data-act="compare" title="Compare sweep (tables + HTML report)">📊</button>
                        <button class="tree-act" data-act="new-subfolder" title="New subfolder">＋</button>
                        <button class="tree-act" data-act="export" title="Export folder">📤</button>
                        <button class="tree-act" data-act="delete" title="Delete folder">🗑</button>
                    </span>
                </div>`;
            if (open) html += this.renderChildren(f.id, depth + 1);
        }

        for (const u of uploads) {
            html += `
                <div class="tree-row tree-file" data-kind="upload" data-id="${u.id}" draggable="true" style="${pad(depth)}">
                    <span class="tree-twisty"></span>
                    <span class="tree-icon">📄</span>
                    <span class="tree-name" data-act="open" title="${esc(u.name)} — click to open">${esc(u.name)}</span>
                    ${gradeBadge(gradeContent(u.content))}
                    <span class="tree-time">${relativeTime(u.uploadedAt)}</span>
                    <span class="tree-row-actions">
                        <button class="tree-act" data-act="rename" title="Rename">✎</button>
                        <button class="tree-act" data-act="delete" title="Delete">🗑</button>
                    </span>
                </div>`;
        }

        return html;
    }

    private gradeFolder(folderId: string): Grade {
        let resolved = 0;
        let total = 0;
        for (const u of this.store.uploadsIn(folderId)) {
            const g = gradeContent(u.content);
            resolved += g.resolved;
            total += g.total;
        }
        for (const f of this.store.foldersIn(folderId)) {
            const g = this.gradeFolder(f.id);
            resolved += g.resolved;
            total += g.total;
        }
        return { resolved, total };
    }

    private wire(tree: HTMLElement): void {
        this.container.querySelector('[data-act="new-root-folder"]')
            ?.addEventListener('click', () => this.newFolder(null));
        this.container.querySelector('[data-act="collapse"]')
            ?.addEventListener('click', () => this.toggle());
        this.container.querySelector('[data-act="import"]')
            ?.addEventListener('click', () => this.importFlow());
        this.container.querySelector('[data-act="export-all"]')
            ?.addEventListener('click', () => downloadBundle(this.store.exportAll(), 'swebench-library'));

        tree.querySelectorAll<HTMLElement>('.tree-row').forEach(row => {
            const kind = row.dataset.kind as 'folder' | 'upload';
            const id = row.dataset.id!;

            row.querySelector('[data-act="toggle"]')?.addEventListener('click', e => {
                e.stopPropagation();
                this.toggleFolder(id);
            });
            row.querySelector('[data-act="new-subfolder"]')?.addEventListener('click', e => {
                e.stopPropagation();
                this.newFolder(id);
            });
            row.querySelector('[data-act="export"]')?.addEventListener('click', e => {
                e.stopPropagation();
                downloadBundle(this.store.exportFolder(id), this.findFolderName(id) || 'folder');
            });
            row.querySelector('[data-act="compare"]')?.addEventListener('click', e => {
                e.stopPropagation();
                openSweepOverlay(this.store, id, this.findFolderName(id) || 'Sweep');
            });
            row.querySelector('[data-act="delete"]')?.addEventListener('click', e => {
                e.stopPropagation();
                this.deleteItem(kind, id);
            });
            row.querySelector('[data-act="open"]')?.addEventListener('click', e => {
                e.stopPropagation();
                const upload = this.store.getUpload(id);
                if (upload) this.onOpen(upload);
            });

            row.querySelector('.tree-name')?.addEventListener('dblclick', e => {
                e.stopPropagation();
                this.renameItem(kind, id);
            });
            row.querySelector('button[data-act="rename"]')?.addEventListener('click', e => {
                e.stopPropagation();
                this.renameItem(kind, id);
            });

            // Drag to move into a folder (or to the root area).
            row.addEventListener('dragstart', e => {
                e.dataTransfer?.setData('text/plain', JSON.stringify({ kind, id }));
                e.stopPropagation();
            });
            if (kind === 'folder') {
                row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drop-target'); });
                row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
                row.addEventListener('drop', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    row.classList.remove('drop-target');
                    this.handleDrop(e, id);
                });
            }
        });

        // Dropping on empty tree space moves the item back to the root.
        tree.addEventListener('dragover', e => e.preventDefault());
        tree.addEventListener('drop', e => {
            if (e.target === tree) {
                e.preventDefault();
                this.handleDrop(e, null);
            }
        });
    }

    private handleDrop(e: DragEvent, targetFolderId: string | null): void {
        const raw = e.dataTransfer?.getData('text/plain');
        if (!raw) return;
        let payload: { kind: string; id: string };
        try { payload = JSON.parse(raw); } catch { return; }
        if (payload.kind === 'upload') {
            this.store.moveUpload(payload.id, targetFolderId);
        } else if (payload.kind === 'folder') {
            this.store.moveFolder(payload.id, targetFolderId);
        }
        if (targetFolderId) this.expanded.add(targetFolderId);
        this.render();
    }

    private importFlow(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                const bundle = JSON.parse(await file.text());
                const res = this.store.importBundle(bundle);
                this.expanded.add(res.rootId);
                this.render();
                alertModal(`Imported ${res.uploads} trace${res.uploads === 1 ? '' : 's'} into "${bundle.name || 'Imported'}".`, 'Import');
            } catch (e) {
                alertModal(`Could not import: ${e instanceof Error ? e.message : String(e)}`, 'Import');
            }
        };
        input.click();
    }

    private async newFolder(parentId: string | null): Promise<void> {
        const name = await promptModal('Folder name:', 'New folder', 'New folder');
        if (!name || !name.trim()) return;
        this.store.createFolder(name.trim(), parentId);
        if (parentId) this.expanded.add(parentId);
        this.render();
    }

    private async renameItem(kind: 'folder' | 'upload', id: string): Promise<void> {
        const current = kind === 'folder' ? this.findFolderName(id) : this.store.getUpload(id)?.name;
        const name = await promptModal('Rename to:', current || '', 'Rename');
        if (!name || !name.trim()) return;
        if (kind === 'folder') this.store.renameFolder(id, name.trim());
        else this.store.renameUpload(id, name.trim());
        this.render();
    }

    private findFolderName(id: string): string | undefined {
        const walk = (pid: string | null): LibFolder | undefined => {
            for (const f of this.store.foldersIn(pid)) {
                if (f.id === id) return f;
                const found = walk(f.id);
                if (found) return found;
            }
            return undefined;
        };
        return walk(null)?.name;
    }

    private async deleteItem(kind: 'folder' | 'upload', id: string): Promise<void> {
        const msg = kind === 'folder'
            ? 'Delete this folder and everything inside it?'
            : 'Delete this upload?';
        if (!(await confirmModal(msg, 'Delete'))) return;
        if (kind === 'folder') this.store.deleteFolder(id);
        else this.store.deleteUpload(id);
        this.render();
    }

    private toggleFolder(id: string): void {
        if (this.expanded.has(id)) this.expanded.delete(id);
        else this.expanded.add(id);
        this.render();
    }

    private toggle(): void {
        this.collapsed = !this.collapsed;
        this.render();
    }
}
