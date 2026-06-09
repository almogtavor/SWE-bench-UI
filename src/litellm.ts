// Parse the stringified Python repr that litellm/OpenAI traces store for a
// choice, e.g.
//   Choices(finish_reason='tool_calls', index=0, message=Message(
//     content=None, role='assistant',
//     tool_calls=[ChatCompletionMessageToolCall(
//       function=Function(arguments='{"path": "a.py"}', name='read_file'), ...)]))
// into something we can render as tool-call cards instead of raw text.

export interface ToolCall { name: string; arguments: string; }
export interface ParsedChoice {
    finishReason: string;
    content: string;
    toolCalls: ToolCall[];
}

export function parseChoiceRepr(repr: string): ParsedChoice {
    const finish = repr.match(/finish_reason=(?:'([^']*)'|"([^"]*)")/);
    const content =
        matchQuoted(repr, /content='((?:\\.|[^'\\])*)'/) ??
        matchQuoted(repr, /content="((?:\\.|[^"\\])*)"/) ??
        '';

    const toolCalls: ToolCall[] = [];
    // arguments-first form: Function(arguments='...', name='...')
    const re1 = /Function\(\s*arguments=(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*,\s*name=(?:'([^']*)'|"([^"]*)")/g;
    // name-first form: Function(name='...', arguments='...')
    const re2 = /Function\(\s*name=(?:'([^']*)'|"([^"]*)")\s*,\s*arguments=(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")/g;

    let m: RegExpExecArray | null;
    while ((m = re1.exec(repr)) !== null) {
        toolCalls.push({ arguments: unescapePy(m[1] ?? m[2] ?? ''), name: m[3] ?? m[4] ?? '' });
    }
    while ((m = re2.exec(repr)) !== null) {
        toolCalls.push({ name: m[1] ?? m[2] ?? '', arguments: unescapePy(m[3] ?? m[4] ?? '') });
    }

    return {
        finishReason: finish ? (finish[1] ?? finish[2] ?? '') : '',
        content: unescapePy(content),
        toolCalls,
    };
}

function matchQuoted(text: string, re: RegExp): string | null {
    const m = text.match(re);
    return m ? m[1] : null;
}

function unescapePy(s: string): string {
    return s.replace(/\\(n|t|r|'|"|\\)/g, (_m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
}
