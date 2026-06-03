export interface Request {
    resolved?: boolean;
    success?: boolean;
    test_result?: string;
    messages?: Array<{ role: string; content: string }>;
    prompt?: string;
    response?: string | object;
    prompt_tokens?: number;
    completion_tokens?: number;
    latency_seconds?: number;
}

export function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

export function getResolvedStatus(req: Request): boolean | null {
    return req.resolved !== undefined ? req.resolved :
           req.success !== undefined ? req.success :
           req.test_result !== undefined ? req.test_result === 'passed' :
           null;
}

export function getStatusColor(resolved: boolean | null): string {
    return resolved ? '#10b981' : '#ef4444';
}

export function getStatusText(resolved: boolean | null): string {
    return resolved ? '✅ PASS' : '❌ FAIL';
}
