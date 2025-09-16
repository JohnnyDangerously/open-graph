# Open Graph / Grandgraph Demo

This repository contains a demo Electron + React + Vite application (`grandgraph-demo`) showcasing a WebGL/REGL scene, along with a small Python `app/` module and supporting scripts.

## Structure

- `grandgraph-demo/`: Electron + React + Vite front-end
  - `renderer/`: React app source
  - `electron/`: Electron main process
- `app/`: Python package stub
- `resolve_snippet.py`: Utility script

## Prerequisites

- Node.js 18+
- npm 9+
- Python 3.10+

## Development (Electron + Vite)

```bash
cd grandgraph-demo
npm install
npm run dev
```

This runs Vite on port 5174 and launches Electron pointed to the dev server.

## Build

```bash
cd grandgraph-demo
npm install
npm run build
```

## Start (Electron)

```bash
cd grandgraph-demo
npm install
npm run start
```

## Notes

- Consider setting environment variables in a local `.env` file (not committed).
- See `.gitignore` for ignored files/directories.
