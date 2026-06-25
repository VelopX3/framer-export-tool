# Framer Export Tool ⚡

> Export any Framer site's source code as a clean ZIP — with watermarks removed.

Paste a Framer URL, click **Initiate**, and download a standalone bundle with:
- ❌ No **"Made in Framer"** badge
- ❌ No **"Edit Content"** button or pencil icon
- ✅ All CSS, JS, images, and fonts included
- ✅ Relative asset paths (works offline)

---

## Features

- 🔗 Works with any `*.framer.app` or custom-domain Framer site
- 🧹 5-layer watermark removal (DOM selectors, text sweep, script stripping, CSS kill-switch)
- 📦 Downloads up to 200 assets concurrently
- ⚡ Real-time progress polling — no page refresh needed
- 🌑 Sleek dark devtool UI

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite + Tailwind CSS + shadcn/ui |
| API | Express 5 + Node.js 24 |
| HTML Parsing | Cheerio |
| Zip Packaging | Archiver |
| Validation | Zod v4 |
| Monorepo | pnpm workspaces |

---

## Getting Started

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [pnpm](https://pnpm.io/) — install with `npm install -g pnpm`

### Install

```bash
pnpm install --ignore-scripts
```

> `--ignore-scripts` is required on Windows (the preinstall guard uses bash).

### Run

Open **two terminals**:

**Terminal 1 — API server** (port 8080):
```bash
pnpm --filter @workspace/api-server run dev
```

**Terminal 2 — Frontend** (port 23414):
```bash
pnpm --filter @workspace/framer-export run dev
```

Then open **http://localhost:23414** in your browser.

---

## How It Works

```
User pastes URL → POST /api/export/start → jobId returned
Frontend polls  → GET  /api/export/:jobId/status (every 1.5s)
Backend fetches → HTML parsed with Cheerio
                → Watermarks removed (5 layers)
                → Assets downloaded concurrently
                → ZIP built with Archiver
GET /api/export/:jobId/download → ZIP sent to browser
```

### Watermark Removal Layers

1. **Badge DOM removal** — `#__framer-badge-container` and all known badge selectors
2. **Edit UI removal** — `[class*="framer-cms"]`, `[class*="edit-content"]`, etc.
3. **Text sweep** — removes any element whose text is exactly `"Made in Framer"` or `"Edit Content"`
4. **Script stripping** — removes `<script>` tags that inject the badge/edit UI at runtime
5. **CSS kill-switch** — injects `display:none !important` for all watermark selectors into the exported HTML

---

## Project Structure

```
├── artifacts/
│   ├── api-server/          # Express API (export logic, zip builder)
│   │   └── src/routes/export.ts
│   └── framer-export/       # React frontend (Vite + Tailwind + shadcn)
│       └── src/pages/home.tsx
├── lib/
│   ├── api-client-react/    # Generated React Query hooks (Orval)
│   ├── api-spec/            # OpenAPI spec (source of truth)
│   └── api-zod/             # Generated Zod schemas
└── pnpm-workspace.yaml
```

---

## Notes

- Jobs are in-memory only — they expire after **1 hour**
- Max **200 assets** downloaded per export
- Asset downloads have a **10s timeout** each
- The ZIP is buffered in memory — large sites may use significant RAM

---

## License

MIT
