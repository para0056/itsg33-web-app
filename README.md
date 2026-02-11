# ITSG-33 Controls Browser

A static web application for browsing and searching the ITSG-33 Annex 3A security control catalog.

The app is built from extracted source data and published as static files, so it can be hosted on GitHub Pages with low operational overhead.

## ⚠️ IMPORTANT DISCLAIMER ⚠️

This repository is not affiliated or endorsed by the Government of Canada.

It merely exists as a convenience browsing tool.

This tool contains code that was generated using OpenAI's GPT-5.2 and GPT-5.3 models.

## Current scope

- Browse controls and enhancements from extracted catalog data
- Search controls by ID, name, aliases, keywords, and enhancement IDs
- Deep-link directly to a control or enhancement via URL query params
- Navigate related controls with in-app links
- View helper guidance for `[Assignment: ...]` placeholders (UI convenience only)
- Export assignment placeholders and guidance to CSV

## Repository layout

- `apps/web` - React + Vite static frontend
- `data/source` - downloaded source artifacts (PDF fallback)
- `data/controls` - extracted controls, index, metadata, and assignment reports
- `scripts` - extraction, publish, and reporting scripts
- `.github/workflows/pages-nightly.yml` - scheduled Pages build/deploy
- `apps/api` - legacy backend prototype (not required for current static app flow)

## Data pipeline

Primary extractor (recommended):

1. Fetch latest Annex 3A page data from CCCS HTML/API
2. Parse controls/enhancements into JSON files
3. Build control index and catalog metadata
4. Copy generated JSON into `apps/web/public/api/controls`
5. Build and deploy static web app

Backup extractor:

- PDF-based extractor is retained as a fallback when HTML extraction is unavailable.

## Local development

Prerequisites:

- Node.js 20+

Install dependencies:

```bash
cd scripts && npm ci
cd ../apps/web && npm ci
```

Rebuild controls from HTML source and publish to web public data:

```bash
cd scripts
npm run extract:annex3a
npm run publish:controls
```

Run the web app locally:

```bash
cd apps/web
npm run dev
```

Note:

- This repository is configured to stay lean: extracted/published control JSON artifacts are gitignored and not committed.
- Before running the app locally, run the extract + publish steps so `apps/web/public/api/controls` is populated.

Optional fallback extraction from PDF:

```bash
cd scripts
npm run extract:annex3a:pdf
npm run publish:controls
```

Generate assignment CSV report:

```bash
cd scripts
npm run report:assignments
```

## GitHub Pages deployment

The workflow in `.github/workflows/pages-nightly.yml` supports:

- Nightly extraction/build/deploy
- Manual run via `workflow_dispatch`
- Automatic base path handling for user/org pages vs project pages

GitHub Pages serves the built `apps/web/dist` artifact.

## Cost estimate (GitHub Pages)

Typical cost is effectively **$0** for personal or public project usage within GitHub-hosted runner and Pages limits.

Potential cost only appears when you exceed included GitHub Actions minutes/storage on your plan, or if you move to self-hosted/private enterprise constraints.

## Data/source notes

- This project is independent and not affiliated with CCCS/CSE/Government of Canada.
- The authoritative source remains the official CCCS publication/site.
- Assignment helper text in the UI is generated guidance and should not be treated as authoritative policy language.
