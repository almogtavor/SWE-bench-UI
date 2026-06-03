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
    return resolved ? '#10b981' : '#ef4444';
}
export function getStatusText(resolved) {
    return resolved ? '✅ PASS' : '❌ FAIL';
}
//# sourceMappingURL=utils.js.map