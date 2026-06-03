<div align="center">

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

## Project Structure

```
SWE-bench-UI/
├── index.html          # Main HTML entry point
├── css/
│   └── styles.css      # All styling (light/dark themes)
├── js/
│   ├── app.js         # Main app class and initialization
│   ├── ui.js          # UI rendering functions
│   ├── theme.js       # Theme manager
│   ├── fileHandling.js # File upload and parsing
│   ├── navigation.js   # Request navigation logic
│   └── utils.js       # Utility functions
└── README.md
```

## Features

- Multi-dump support (up to 4 concurrent dumps)
- Generic interface (works with any SWE bench format)
- Customizable dump names
- Side-by-side request comparison
- Dark/light mode toggle with localStorage persistence
- Drag-and-drop file upload
- Request navigation with keyboard support
- Metrics display (tokens, latency)
- Pass/fail evaluation detection

## License

MIT
