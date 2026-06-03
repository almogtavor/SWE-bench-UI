# SWE-bench-UI

Generic viewer for SWE bench evaluation results. Upload, compare, and analyze SWE bench dumps side-by-side.

## Features

- **Multi-dump support**: Load up to 4 evaluation dumps simultaneously
- **Generic interface**: Works with any SWE bench result format
- **Customizable names**: Rename each dump after uploading
- **Side-by-side view**: Compare results across multiple evaluations
- **Dark/light mode**: Toggle between themes
- **Drag-and-drop**: Easy file upload with drag-and-drop zones

## Usage

1. Open `index.html` in a browser
2. Click "+ Add Dump" to add evaluation result dumps
3. Drag a JSON dump file onto a panel or click to browse
4. Double-click dump names to customize labels
5. Compare results across all loaded dumps

## Supported Formats

- Direct SWE bench result exports (JSON)
- Baseline/SPANS nested format
- JSONL format (line-delimited)
- Simple request/response arrays

## License

MIT
