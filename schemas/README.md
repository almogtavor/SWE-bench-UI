# Supported input schemas

[SWE-bench-UI](https://almogtavor.github.io/SWE-bench-UI/) auto-detects the
format of each file you drop in. These are the formats it understands, with a
JSON Schema for each.

| Format | When to use | Schema |
|--------|-------------|--------|
| **LiteLLM trace** | `trace.jsonl` from an agent run: one LLM call per line. Stitched into a single conversation. | [litellm-trace.schema.json](litellm-trace.schema.json) |
| **Trajectory** | `trajectory.jsonl`: alternating `action` / `observation` events (bash, message, tool calls). | [trajectory.schema.json](trajectory.schema.json) |
| **SWE-bench flat export** | One record per task instance (JSON array or JSONL). Each becomes an R1, R2... tab with a resolved badge. | [swebench-flat.schema.json](swebench-flat.schema.json) |
| **Baseline / SPANS nested** | A single object wrapping records under `baseline.requests`, `spans.requests`, or `requests`. | [baseline-spans.schema.json](baseline-spans.schema.json) |

## Detection order

1. **Trajectory** — record has `event: "action" | "observation"`.
2. **LiteLLM trace** — record has `request.messages[]` and a `response`/`trace_id`.
3. **Baseline / SPANS** — top-level object with `baseline`/`spans`/`requests`.
4. **SWE-bench flat** — anything else; each record is treated as one task.

## Resolved badge

Tasks are graded from the first of `resolved`, `success`, or `test_result`
(`"passed"`) that is present:

- 🟢 `1/1` resolved
- 🔴 `0/1` not resolved
- ⚪ `ungraded` (no grade in the file, e.g. raw trace/trajectory logs)
