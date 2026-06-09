// Local, browser-only library of past uploads. Everything lives in
// localStorage so a user's traces and the folders they organise them into
// survive page reloads without any backend.
import { confirmModal, promptModal, alertModal } from './modal.js';
const STORAGE_KEY = 'swebench-ui-library';
function newId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function')
        return c.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export class LibraryStore {
    constructor() {
        this.data = { folders: [], uploads: [] };
        this.load();
    }
    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.data = {
                    folders: Array.isArray(parsed.folders) ? parsed.folders : [],
                    uploads: Array.isArray(parsed.uploads) ? parsed.uploads : [],
                };
            }
        }
        catch {
            this.data = { folders: [], uploads: [] };
        }
    }
    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
            return true;
        }
        catch (e) {
            alertModal('Could not save to local storage (it may be full). Delete some uploads and try again.', 'Storage full');
            return false;
        }
    }
    /** Persist an upload. Identical name+content just bumps the timestamp. */
    addUpload(name, content, folderId = null) {
        const existing = this.data.uploads.find(u => u.name === name && u.content === content);
        if (existing) {
            existing.uploadedAt = Date.now();
            this.save();
            return existing;
        }
        const upload = { id: newId(), name, content, uploadedAt: Date.now(), folderId };
        this.data.uploads.push(upload);
        this.save();
        return upload;
    }
    createFolder(name, parentId = null) {
        const folder = { id: newId(), name, parentId };
        this.data.folders.push(folder);
        this.save();
        return folder;
    }
    renameFolder(id, name) {
        const f = this.data.folders.find(f => f.id === id);
        if (f) {
            f.name = name;
            this.save();
        }
    }
    renameUpload(id, name) {
        const u = this.data.uploads.find(u => u.id === id);
        if (u) {
            u.name = name;
            this.save();
        }
    }
    deleteUpload(id) {
        this.data.uploads = this.data.uploads.filter(u => u.id !== id);
        this.save();
    }
    /** Delete a folder and everything inside it, recursively. */
    deleteFolder(id) {
        const toRemove = new Set();
        const collect = (fid) => {
            toRemove.add(fid);
            this.data.folders.filter(f => f.parentId === fid).forEach(c => collect(c.id));
        };
        collect(id);
        this.data.folders = this.data.folders.filter(f => !toRemove.has(f.id));
        this.data.uploads = this.data.uploads.filter(u => !(u.folderId && toRemove.has(u.folderId)));
        this.save();
    }
    moveUpload(id, folderId) {
        const u = this.data.uploads.find(u => u.id === id);
        if (u) {
            u.folderId = folderId;
            this.save();
        }
    }
    /** Move a folder, refusing moves that would create a cycle. */
    moveFolder(id, parentId) {
        if (id === parentId)
            return;
        if (parentId && this.isDescendant(parentId, id))
            return;
        const f = this.data.folders.find(f => f.id === id);
        if (f) {
            f.parentId = parentId;
            this.save();
        }
    }
    isDescendant(candidateId, ancestorId) {
        let current = this.data.folders.find(f => f.id === candidateId);
        while (current && current.parentId) {
            if (current.parentId === ancestorId)
                return true;
            current = this.data.folders.find(f => f.id === current.parentId);
        }
        return false;
    }
    foldersIn(parentId) {
        return this.data.folders
            .filter(f => f.parentId === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    uploadsIn(folderId) {
        return this.data.uploads
            .filter(u => u.folderId === folderId)
            .sort((a, b) => b.uploadedAt - a.uploadedAt);
    }
    getUpload(id) {
        return this.data.uploads.find(u => u.id === id);
    }
}
function relativeTime(ts) {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60)
        return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)
        return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7)
        return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
}
function esc(text) {
    return text.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}
export class Sidebar {
    constructor(containerId, store, onOpen) {
        this.expanded = new Set();
        this.collapsed = false;
        const el = document.getElementById(containerId);
        if (!el)
            throw new Error(`Sidebar container ${containerId} not found`);
        this.container = el;
        this.store = store;
        this.onOpen = onOpen;
    }
    render() {
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
                    <button class="sidebar-btn" data-act="collapse" title="Hide library">⟨</button>
                </div>
            </div>
            <div class="sidebar-tree" id="sidebarTree"></div>`;
        const tree = this.container.querySelector('#sidebarTree');
        tree.innerHTML = this.renderChildren(null, 0);
        this.wire(tree);
    }
    renderChildren(parentId, depth) {
        const folders = this.store.foldersIn(parentId);
        const uploads = this.store.uploadsIn(parentId);
        if (depth === 0 && folders.length === 0 && uploads.length === 0) {
            return `<div class="sidebar-empty">No uploads yet.<br>Drop a file in a panel to save it here.</div>`;
        }
        const pad = (d) => `padding-left:${8 + d * 14}px`;
        let html = '';
        for (const f of folders) {
            const open = this.expanded.has(f.id);
            html += `
                <div class="tree-row tree-folder" data-kind="folder" data-id="${f.id}" draggable="true" style="${pad(depth)}">
                    <span class="tree-twisty" data-act="toggle">${open ? '▾' : '▸'}</span>
                    <span class="tree-icon">${open ? '📂' : '📁'}</span>
                    <span class="tree-name" data-act="rename" title="Double-click to rename">${esc(f.name)}</span>
                    <span class="tree-row-actions">
                        <button class="tree-act" data-act="new-subfolder" title="New subfolder">＋</button>
                        <button class="tree-act" data-act="delete" title="Delete folder">🗑</button>
                    </span>
                </div>`;
            if (open)
                html += this.renderChildren(f.id, depth + 1);
        }
        for (const u of uploads) {
            html += `
                <div class="tree-row tree-file" data-kind="upload" data-id="${u.id}" draggable="true" style="${pad(depth)}">
                    <span class="tree-twisty"></span>
                    <span class="tree-icon">📄</span>
                    <span class="tree-name" data-act="open" title="${esc(u.name)} — click to open">${esc(u.name)}</span>
                    <span class="tree-time">${relativeTime(u.uploadedAt)}</span>
                    <span class="tree-row-actions">
                        <button class="tree-act" data-act="rename" title="Rename">✎</button>
                        <button class="tree-act" data-act="delete" title="Delete">🗑</button>
                    </span>
                </div>`;
        }
        return html;
    }
    wire(tree) {
        this.container.querySelector('[data-act="new-root-folder"]')
            ?.addEventListener('click', () => this.newFolder(null));
        this.container.querySelector('[data-act="collapse"]')
            ?.addEventListener('click', () => this.toggle());
        tree.querySelectorAll('.tree-row').forEach(row => {
            const kind = row.dataset.kind;
            const id = row.dataset.id;
            row.querySelector('[data-act="toggle"]')?.addEventListener('click', e => {
                e.stopPropagation();
                this.toggleFolder(id);
            });
            row.querySelector('[data-act="new-subfolder"]')?.addEventListener('click', e => {
                e.stopPropagation();
                this.newFolder(id);
            });
            row.querySelector('[data-act="delete"]')?.addEventListener('click', e => {
                e.stopPropagation();
                this.deleteItem(kind, id);
            });
            row.querySelector('[data-act="open"]')?.addEventListener('click', e => {
                e.stopPropagation();
                const upload = this.store.getUpload(id);
                if (upload)
                    this.onOpen(upload);
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
    handleDrop(e, targetFolderId) {
        const raw = e.dataTransfer?.getData('text/plain');
        if (!raw)
            return;
        let payload;
        try {
            payload = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (payload.kind === 'upload') {
            this.store.moveUpload(payload.id, targetFolderId);
        }
        else if (payload.kind === 'folder') {
            this.store.moveFolder(payload.id, targetFolderId);
        }
        if (targetFolderId)
            this.expanded.add(targetFolderId);
        this.render();
    }
    async newFolder(parentId) {
        const name = await promptModal('Folder name:', 'New folder', 'New folder');
        if (!name || !name.trim())
            return;
        this.store.createFolder(name.trim(), parentId);
        if (parentId)
            this.expanded.add(parentId);
        this.render();
    }
    async renameItem(kind, id) {
        const current = kind === 'folder' ? this.findFolderName(id) : this.store.getUpload(id)?.name;
        const name = await promptModal('Rename to:', current || '', 'Rename');
        if (!name || !name.trim())
            return;
        if (kind === 'folder')
            this.store.renameFolder(id, name.trim());
        else
            this.store.renameUpload(id, name.trim());
        this.render();
    }
    findFolderName(id) {
        const walk = (pid) => {
            for (const f of this.store.foldersIn(pid)) {
                if (f.id === id)
                    return f;
                const found = walk(f.id);
                if (found)
                    return found;
            }
            return undefined;
        };
        return walk(null)?.name;
    }
    async deleteItem(kind, id) {
        const msg = kind === 'folder'
            ? 'Delete this folder and everything inside it?'
            : 'Delete this upload?';
        if (!(await confirmModal(msg, 'Delete')))
            return;
        if (kind === 'folder')
            this.store.deleteFolder(id);
        else
            this.store.deleteUpload(id);
        this.render();
    }
    toggleFolder(id) {
        if (this.expanded.has(id))
            this.expanded.delete(id);
        else
            this.expanded.add(id);
        this.render();
    }
    toggle() {
        this.collapsed = !this.collapsed;
        this.render();
    }
}
//# sourceMappingURL=library.js.map