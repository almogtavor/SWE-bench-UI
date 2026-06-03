<div align="center">

<img src="logo.png" width="25%">

# SWE-bench-UI

Generic viewer for SWE bench evaluation results. Upload, compare, and analyze SWE bench dumps side-by-side.

[![Deploy](https://img.shields.io/badge/deployed-GitHub%20Pages-blue?logo=github)](https://almogtavor.github.io/SWE-bench-UI/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

## Quick Start

**Online:** [https://almogtavor.github.io/SWE-bench-UI/](https://almogtavor.github.io/SWE-bench-UI/)

**Local:** Open `index.html` in your browser or run a local server:
```bash
python -m http.server 8000
# Open http://localhost:8000
```

## Usage

1. Click "+ Add Dump" to add evaluation result dumps (up to 4)
2. Drag a JSON/JSONL dump file onto a panel or click to browse
3. Double-click dump names to customize labels
4. Click request buttons (R1, R2, etc) to view individual traces
5. Toggle dark/light mode with the 🌙 button

## Supported Formats

- Direct SWE bench result exports (JSON)
- Baseline/SPANS nested format
- JSONL format (line-delimited LiteLLM traces)
- Simple request/response arrays

## Features

- Multi-dump support (up to 4 concurrent dumps)
- Generic interface (works with any SWE bench format)
- Customizable dump names
- Side-by-side request comparison
- Dark/light mode toggle
- Drag-and-drop file upload

## License

MIT
