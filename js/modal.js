// In-app modal dialogs to replace the browser's native alert/confirm/prompt,
// so they match the app theme instead of Chrome's grey popup.
function openModal(opts) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal';
        if (opts.title) {
            const title = document.createElement('div');
            title.className = 'modal-title';
            title.textContent = opts.title;
            modal.appendChild(title);
        }
        const msg = document.createElement('div');
        msg.className = 'modal-msg';
        msg.textContent = opts.message;
        modal.appendChild(msg);
        let inputEl = null;
        if (opts.input) {
            inputEl = document.createElement('input');
            inputEl.className = 'modal-input';
            inputEl.type = 'text';
            inputEl.value = opts.defaultValue ?? '';
            modal.appendChild(inputEl);
        }
        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        let settled = false;
        const close = (result) => {
            if (settled)
                return;
            settled = true;
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(result);
        };
        const onCancel = () => close(opts.input ? null : false);
        const onOk = () => close(opts.input ? (inputEl ? inputEl.value : '') : true);
        if (opts.cancelText !== null) {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'modal-btn cancel';
            cancelBtn.textContent = opts.cancelText ?? 'Cancel';
            cancelBtn.addEventListener('click', onCancel);
            actions.appendChild(cancelBtn);
        }
        const okBtn = document.createElement('button');
        okBtn.className = 'modal-btn ok';
        okBtn.textContent = opts.okText ?? 'OK';
        okBtn.addEventListener('click', onOk);
        actions.appendChild(okBtn);
        modal.appendChild(actions);
        overlay.appendChild(modal);
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay)
                onCancel();
        });
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
            else if (e.key === 'Enter') {
                e.preventDefault();
                onOk();
            }
        };
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        if (inputEl) {
            inputEl.focus();
            inputEl.select();
        }
        else
            okBtn.focus();
    });
}
export function confirmModal(message, title = 'Confirm') {
    return openModal({ title, message, okText: 'OK', cancelText: 'Cancel' }).then(r => r === true);
}
export function promptModal(message, defaultValue = '', title = 'Rename') {
    return openModal({ title, message, input: true, defaultValue, okText: 'OK', cancelText: 'Cancel' })
        .then(r => (typeof r === 'string' ? r : null));
}
export function alertModal(message, title = 'Notice') {
    return openModal({ title, message, okText: 'OK', cancelText: null }).then(() => undefined);
}
//# sourceMappingURL=modal.js.map