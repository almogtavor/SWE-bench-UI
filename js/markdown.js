// Tiny dependency-free markdown renderer + code highlighter. The site ships
// raw ES modules with no bundler, so we can't pull in marked/highlight.js;
// this covers the markdown that shows up in agent transcripts (fenced code,
// headings, lists, emphasis, links, inline code) and highlights Python/JSON.
import { escapeHtml } from './utils.js';
const PH_OPEN = '@@MD';
const PH_CLOSE = '@@';
const PH_RE = /@@MD(\d+)@@/g;
const PH_LINE_RE = /^@@MD\d+@@$/;
export function renderMarkdown(src) {
    if (!src)
        return '';
    const placeholders = [];
    const stash = (htmlPiece) => {
        placeholders.push(htmlPiece);
        return `${PH_OPEN}${placeholders.length - 1}${PH_CLOSE}`;
    };
    // 1. Pull fenced code blocks out of the RAW text first, highlight them.
    let text = src.replace(/```([\w+\-.]*)[ \t]*\r?\n?([\s\S]*?)```/g, (_m, lang, code) => {
        const inner = highlightCode(String(code).replace(/\n$/, ''), String(lang || '').toLowerCase());
        return stash(`<pre class="md-code"><code>${inner}</code></pre>`);
    });
    // 2. Pull inline `code` spans out before escaping the rest.
    text = text.replace(/`([^`\n]+)`/g, (_m, code) => stash(`<code class="md-inline">${escapeHtml(code)}</code>`));
    // 3. Escape everything else, then apply block + inline markdown.
    text = renderBlocks(escapeHtml(text));
    // 4. Restore the code placeholders.
    text = text.replace(PH_RE, (_m, i) => placeholders[Number(i)] || '');
    return text;
}
function renderBlocks(text) {
    const lines = text.split('\n');
    const out = [];
    let para = [];
    let list = null;
    let quote = [];
    const flushPara = () => {
        if (para.length) {
            out.push(`<p>${para.map(inline).join('<br>')}</p>`);
            para = [];
        }
    };
    const flushList = () => {
        if (list) {
            out.push(`<${list.type}>${list.items.map(li => `<li>${inline(li)}</li>`).join('')}</${list.type}>`);
            list = null;
        }
    };
    const flushQuote = () => {
        if (quote.length) {
            out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
            quote = [];
        }
    };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };
    for (const raw of lines) {
        const line = raw.replace(/\s+$/, '');
        // a line that is just a code-block placeholder is its own block
        if (PH_LINE_RE.test(line.trim())) {
            flushAll();
            out.push(line.trim());
            continue;
        }
        if (line.trim() === '') {
            flushAll();
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushAll();
            const n = heading[1].length;
            out.push(`<h${n} class="md-h">${inline(heading[2])}</h${n}>`);
            continue;
        }
        if (/^(\s*)([-*_])(\s*\2){2,}\s*$/.test(line)) {
            flushAll();
            out.push('<hr>');
            continue;
        }
        const quoteMatch = line.match(/^>\s?(.*)$/);
        if (quoteMatch) {
            flushPara();
            flushList();
            quote.push(quoteMatch[1]);
            continue;
        }
        const ul = line.match(/^\s*[-*+]\s+(.*)$/);
        const ol = line.match(/^\s*\d+\.\s+(.*)$/);
        if (ul || ol) {
            flushPara();
            flushQuote();
            const type = ul ? 'ul' : 'ol';
            if (!list || list.type !== type) {
                flushList();
                list = { type, items: [] };
            }
            list.items.push((ul ? ul[1] : ol[1]));
            continue;
        }
        flushList();
        flushQuote();
        para.push(line);
    }
    flushAll();
    return out.join('\n');
}
function inline(text) {
    return text
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
}
export function highlightCode(code, lang) {
    const l = (lang || '').toLowerCase();
    if (l === 'py' || l === 'python')
        return highlightPython(code);
    if (l === 'json')
        return highlightJson(code);
    return escapeHtml(code);
}
const PY_KEYWORDS = /\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|self|print)\b/;
function highlightPython(code) {
    const re = new RegExp('(#[^\\n]*)' + // comment
        "|('''[\\s\\S]*?'''|\"\"\"[\\s\\S]*?\"\"\"|'(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\")" + // string
        '|\\b(\\d+\\.?\\d*)\\b' + // number
        '|' + PY_KEYWORDS.source, // keyword
    'g');
    return tokenize(code, re, (full, g) => {
        if (g[0])
            return span('tok-com', full);
        if (g[1])
            return span('tok-str', full);
        if (g[2])
            return span('tok-num', full);
        return span('tok-kw', full);
    });
}
function highlightJson(code) {
    const re = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|\b(-?\d+\.?\d*)\b/g;
    return tokenize(code, re, (full, g) => {
        if (g[0])
            return span('tok-key', full);
        if (g[1])
            return span('tok-str', full);
        if (g[2])
            return span('tok-kw', full);
        return span('tok-num', full);
    });
}
function tokenize(code, re, pick) {
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
        if (m.index < last) {
            re.lastIndex = last;
            continue;
        }
        out += escapeHtml(code.slice(last, m.index));
        out += pick(m[0], m.slice(1));
        last = m.index + m[0].length;
        if (m[0].length === 0)
            re.lastIndex++;
    }
    out += escapeHtml(code.slice(last));
    return out;
}
function span(cls, text) {
    return `<span class="${cls}">${escapeHtml(text)}</span>`;
}
//# sourceMappingURL=markdown.js.map