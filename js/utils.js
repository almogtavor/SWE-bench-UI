export function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
export function getResolvedStatus(req) {
    return req.resolved !== undefined ? req.resolved :
        req.success !== undefined ? req.success :
            req.test_result !== undefined ? req.test_result === 'passed' :
                null;
}
export function getStatusColor(resolved) {
    return resolved === null ? '#8b949e' : resolved ? '#10b981' : '#ef4444';
}
export function getStatusText(resolved) {
    return resolved === null ? 'ungraded' : resolved ? '1/1 resolved' : '0/1 resolved';
}
/** A clear pass/fail/ungraded pill, e.g. "🟢 1/1" / "🔴 0/1" / "⚪ ungraded". */
export function statusPill(req) {
    const r = getResolvedStatus(req);
    const cls = r === null ? 'ungraded' : r ? 'pass' : 'fail';
    const label = r === null ? '⚪ ungraded' : r ? '🟢 1/1' : '🔴 0/1';
    return `<span class="status-pill ${cls}">${label}</span>`;
}
//# sourceMappingURL=utils.js.map