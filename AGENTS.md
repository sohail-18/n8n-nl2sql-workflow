# Repository Guidelines

## Project Structure & Module Organization
`server.js` hosts the Express proxy that forwards chat payloads to n8n, normalizes responses, and serves static assets. Place new server utilities beside it and keep helper functions pure for easy testing. The `public/` directory contains the single-page chat UI—HTML, styles, and vanilla JS that renders Markdown using markdown-it and highlight.js; add any new static assets here. `index.mjs` is an ES module showcase for the Markdown renderer; use it as a sandbox when tweaking rendering rules before wiring changes into the browser bundle.

## Build, Test, and Development Commands
Run `npm install` once per workspace to fetch dependencies. Use `npm run start` to launch the local server on port 5000; override `PORT`, `N8N_WEBHOOK_URL`, or `N8N_API_KEY` as needed, e.g. `N8N_WEBHOOK_URL=http://localhost:5678/webhook/... npm run start`. Execute `npm run md-demo` to quickly validate Markdown rendering changes in Node without spinning up the UI.

## Coding Style & Naming Conventions
Use two-space indentation and prefer single quotes in Node files to match the current code. Keep front-end scripts modular by grouping DOM helpers and API calls into small functions; name event handlers with an `handle` prefix (e.g. `handleSendClick`). Document tricky logic with concise bilingual comments when necessary because the UI already serves Chinese-speaking users. Lint manually—no automated formatter is configured yet—so review diffs before committing.

## Testing Guidelines
There is no automated suite yet; when adding one, align `npm test` with the chosen runner (e.g. Vitest or Jest) and store specs under `tests/` or next to the modules as `*.spec.js`. For now, smoke-test the REST bridge with `curl` or `httpie` requests to `/api/chat`, and exercise the browser UI to confirm Markdown tables, code highlighting, and session persistence all behave as expected.

## Commit & Pull Request Guidelines
Follow Conventional Commit prefixes (`feat`, `fix`, `chore`, `docs`, `refactor`) so downstream automation can parse the history. Keep messages in the imperative mood and reference issue IDs when available. Pull requests should include a short summary, test evidence (manual steps or command output), screenshots for UI tweaks, and configuration notes for any new environment variables.

## Configuration & Security Notes
Store sensitive n8n URLs or API keys in local environment files—never hardcode them. When updating CORS or webhook endpoints, document the change in the PR description so operators can mirror the configuration in deployment.
