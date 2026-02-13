# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Context Inspector — a full-stack TypeScript app for visualizing Claude Code's context window. Reads JSONL transcript files from `~/.claude/projects/` and renders them as an interactive web UI.

## Commands

```bash
npm run dev            # Start server (tsx --watch) + Vite dev server in parallel
npm run dev:server     # Server only with file watching (port 3456)
npm run dev:client     # Vite only (port 5173, proxies /api → :3456)
npm run build          # Vite production build → dist/
npm run start          # Production server (serves dist/ + API)
npx tsc --noEmit       # Type-check frontend (src/)
npx tsc --noEmit -p tsconfig.node.json  # Type-check server + vite config
```

No tests or linter configured.

## Architecture

**Two-process dev setup:** Vite dev server (port 5173) proxies `/api` to Express server (port 3456). In production, Express serves the built `dist/` directly.

**Server (`server/index.ts`):** Single file. Reads `~/.claude/projects/<project>/<session>.jsonl`, parses each line into typed messages/blocks, computes context composition metrics. Exposes REST API + SSE endpoint (`/api/events`) for live reload via chokidar file watching with 500ms debounce.

**Client (`src/`):** React SPA. `App.tsx` owns top-level navigation state (`View` discriminated union: projects → sessions → session). No router — state-driven page switching. `useLiveReload` hook subscribes to SSE and triggers refresh callbacks.

**Data flow:** JSONL line → `parseLine` → `extractContentBlocks` → `parseTranscriptFull` → `computeContextComposition`. The JSONL format has multiple field name variants for backwards compatibility (e.g., `name`/`tool_name`, `input`/`tool_input`).

**Type system (`src/types.ts`):** Shared client types. `Block` is a discriminated union on `type` field (text, thinking, tool_use, tool_result, summary). Server has its own parallel types (`RawEntry`, `ParsedBlock`, `ParsedMessage`) due to the looser shape of raw JSONL data.

## Key Conventions

- `tsx` (not `ts-node`) for running server TypeScript directly
- Two tsconfig files: `tsconfig.json` (frontend/src), `tsconfig.node.json` (server + vite config)
- Strict TypeScript throughout
- All styling in `src/styles.css` using CSS custom properties (dark theme)
- Color coding: cyan=user, purple=thinking, green=tools, blue=results, amber=summaries

## Usage Stats

**Pricing:** Built-in model pricing table in `server/index.ts` (`MODEL_PRICING`). When JSONL `costUSD` is null (common), cost is calculated from `model + token counts × per-MTok rates`. Pricing source: https://platform.claude.com/docs/en/about-claude/pricing

**Dedup:** Matches ccusage behavior — dedup by `message.id:requestId` hash, skip `<synthetic>` model entries, recursive scan including `subagents/` subdirectories.

**Time ranges:** Calendar-day boundaries (local timezone midnight), not rolling windows.

## Implemented Features

### Context Health Analysis (implemented)

Detects compaction events (`isCompactSummary: true` entries) and computes per-compaction metrics: compression ratio, entity loss/retention, tool calls compacted, time span, composite health score (0-100). `ContextHealthPanel` component renders health score badge, timeline bar with compaction markers, and expandable compaction cards.

### Behavioral Diff (implemented)

Compares pre/post compaction behavioral fingerprints across four dimensions:
- **Tool Usage Shift** — per-tool call frequency change (calls/message). Detects patterns like Read spike post-compaction (memory loss signal).
- **File Focus Shift** — files dropped/added/continued across compaction boundary.
- **Response Pattern Shift** — thinking rate and avg response length change.
- **Topic Shift** — term frequency comparison; highlights topics present pre-compaction but absent from summary (`summaryMissed`).

Severity score: weighted sum of file drift (30), topic drift (30), tool drift (20), coverage gap (20).

## Roadmap

(No pending items.)
