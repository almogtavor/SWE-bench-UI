// Count resolved tasks in a raw trace/export so the library can show "3/12".
// A "task" is any record that carries a grade (resolved / success /
// test_result); session logs (litellm trace, trajectory) carry none, so they
// report total 0 and the tree shows no count for them.
import { extractRecords } from './fileHandling.js';
import { getResolvedStatus } from './utils.js';
const cache = new Map();
export function gradeContent(content) {
    const cached = cache.get(content);
    if (cached)
        return cached;
    let resolved = 0;
    let total = 0;
    try {
        for (const rec of extractRecords(content.trim())) {
            const status = getResolvedStatus(rec);
            if (status !== null) {
                total++;
                if (status)
                    resolved++;
            }
        }
    }
    catch { /* malformed file -> no grade */ }
    const grade = { resolved, total };
    if (cache.size > 200)
        cache.clear();
    cache.set(content, grade);
    return grade;
}
//# sourceMappingURL=grade.js.map