# Framer Exporter

A web tool that lets you paste any Framer site URL and download all its source code as a clean zip file — with the Framer watermark removed.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/framer-export run dev` — run the frontend (port 23414)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- No database required — jobs are stored in-memory with 1hr TTL

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, shadcn/ui, Wouter routing
- API: Express 5
- HTML parsing: Cheerio
- Zip packaging: Archiver
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/api-zod/src/generated/` — generated Zod schemas
- `artifacts/framer-export/src/` — React frontend
- `artifacts/api-server/src/routes/export.ts` — core export logic (fetch, strip watermark, zip)

## Architecture decisions

- Jobs are stored in a simple in-memory Map — no DB needed for ephemeral export jobs
- Export runs async: POST /api/export/start returns a jobId immediately, frontend polls /status
- Watermark removal uses a list of CSS selectors targeting known Framer badge patterns
- Assets are downloaded concurrently (Promise.allSettled) with a 200-asset cap and 10s timeouts
- The zip is built with archiver and buffered in memory, then sent on /download request

## Product

- Paste any Framer site URL (framer.app or custom domain)
- Backend fetches HTML, strips Framer watermark badge, rewrites asset URLs to relative paths
- Downloads all linked CSS/JS/images (up to 200 assets)
- Packages everything as a zip for direct download
- Clean dark devtool UI with real-time status polling

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After any OpenAPI spec change, run codegen before using updated types
- lib/api-zod/src/index.ts uses selective re-exports to avoid naming conflicts between Zod schemas and TypeScript interfaces — do not replace with `export * from "./generated/types"` 
- The archiver requires non-empty entry names — always guard against empty path segments

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
