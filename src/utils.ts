export interface Request {
    resolved?: boolean;
    success?: boolean;
    test_result?: string;
    messages?: Array<{ role: string; content: string }>;
    prompt?: string;
    response?: string | object;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    latency_seconds?: number;
    // Set by the litellm-trace normalizer: marks one LLM call in a session so
    // the UI can stitch the calls into a single conversation instead of tabs.
    _session?: boolean;
    _kind?: 'litellm' | 'trajectory';
    _rawChoice?: string;
    model?: string;
    timestamp?: string;
    trace_id?: string;
    // Trajectory (action/observation) event fields, kept as-is by the normalizer.
    event?: string;
    action?: { name?: string; arguments?: string | object; id?: string };
    observation?: { result?: unknown; invoking_actions?: unknown };
    step?: number;
    task_id?: string;
    instance_id?: string;
    agent_cost?: number;
    benchmark_cost?: number;
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
    return resolved === null ? '#8b949e' : resolved ? '#10b981' : '#ef4444';
}

export function getStatusText(resolved: boolean | null): string {
    return resolved === null ? 'ungraded' : resolved ? '1/1 resolved' : '0/1 resolved';
}

/** A clear pass/fail/ungraded pill, e.g. "🟢 1/1" / "🔴 0/1" / "⚪ ungraded". */
export function statusPill(req: Request): string {
    const r = getResolvedStatus(req);
    const cls = r === null ? 'ungraded' : r ? 'pass' : 'fail';
    const label = r === null ? '⚪ ungraded' : r ? '🟢 1/1' : '🔴 0/1';
    return `<span class="status-pill ${cls}">${label}</span>`;
}
