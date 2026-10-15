# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Salesforce Inspector Advanced is a Chrome/Firefox browser extension (fork of Salesforce Inspector Reloaded) that adds a metadata/productivity layer on top of the standard Salesforce UI: SOQL/SOSL data export, data import, Apex runner, log viewer/profiler, streaming/platform event monitor, flow analyzer, metadata retrieve, dependency viewer, org analyzer, etc.

All extension source lives in `addon/` as **plain, unbundled JS/HTML/CSS** — there is no bundler, no JSX compilation step, and no framework beyond React loaded via `<script>` tags (`react.js`/`react-dom.js`, `.min.js` for release). UI code calls `React.createElement` directly (no JSX). Most feature modules are ES modules imported with `import`/`export` (`type="module"` in HTML/manifest); a few files that can't be modules (content scripts, background page, the React UMD bundles) are listed as exceptions in `.eslintrc.js`.

## Common commands

```
npm install                    # install devDependencies (eslint, fs-extra, replace-in-file, zip-dir)
npm run eslint                 # lint the whole repo (must pass; CI/Travis runs this)
npm run chrome-dev-build       # copy addon/manifest-chrome.json (MV3) to addon/manifest.json
npm run firefox-dev-build      # copy addon/manifest-firefox.json (MV2) to addon/manifest.json
npm run chrome-release-build   # full release zip in target/chrome/
npm run firefox-release-build  # full release zip in target/firefox/
```

There is no `npm test` script — see "Unit tests" below, they run in-browser, not via Node.

### Loading the extension locally

1. Run `npm run chrome-dev-build` (or `firefox-dev-build`) to write `addon/manifest.json` — `scripts/dev-build.js` copies `addon/manifest-<browser>.json` over it. The committed `manifest.json` is the Chrome one, so always run the matching build before loading in Firefox (otherwise Firefox fails with "background.service_worker is currently disabled").
2. Chrome: `chrome://extensions/` → enable Developer mode → Load unpacked → select `addon/`.
3. Firefox: `about:debugging` → Load Temporary Add-on → select `addon/manifest.json`.

### Unit tests

Tests run inside a real Salesforce org via the browser, not Node/Jest/etc.

1. Set up a Developer Edition org: deploy `test/` metadata (`sf deploy metadata -d test/ -o [org-alias]`), set user language to English, enable "Allow users to relate a contact to multiple accounts", ensure no namespace prefix, assign the `SfInspector` permission set.
2. Navigate to `chrome-extension://<id>/test-framework.html?host=<org-domain>` (replace the filename of any extension page with `test-framework.html`).
3. `test-framework.js` (`addon/test-framework.js`) auto-runs every suite registered in its `availableTests` map (currently `popupTest`, `csvParseTest`, `dataImportTest`, `dataExportTest`, `flowAnalyzeTest`, from the sibling `*-test.js` files) unless a `?test=`/`?tests=` query param names a subset. Watch the browser devtools console for failures; success prints "Salesforce Inspector unit test finished successfully".
4. `*-test.js` files are stripped out of release builds (see filter in `scripts/release-build.js`) — they only ship in dev builds.

When adding a feature, add/extend the matching `<feature>-test.js` file and register it in `test-framework.js`'s `availableTests` map if it's a new suite.

### Linting

ESLint config is in `.eslintrc.js` (ES2020/module, 2-space indent, double quotes, required semicolons, `eslint:recommended` plus a large custom style rule set — read the file before writing code so new code matches). `.eslintignore` excludes the vendored React bundles and `target/`.

## Architecture

### Multi-page extension, one entry per tool

Each top-level feature is its own HTML page + same-named `.js` controller loaded as a content-script-invoked popup tab, e.g. `data-export.html`/`.js` (SOQL/SOSL export), `data-import.html`/`.js` (CSV import), `apex-runner.html`/`.js`, `log.html`/`.js`, `streaming.html`/`.js`, `inspect.html`/`.js`, `metadata-retrieve.html`/`.js`, `explore-api.html`/`.js`, `limits.html`/`.js`, `dependency.html`/`.js`, `org-analyzer.html`/`.js`, `options.html`/`.js`, `flow-analyze.html`/`.js`. These are opened as extension tabs (`web_accessible_resources` in the manifest), not iframes/SPA routes.

Each page follows the same internal shape: a `Model` class holding all UI state + business logic (constructed with `{sfHost, args}`), a `didUpdate` callback wired to `ReactDOM.render`, and a React component tree built with `React.createElement`. There's no shared state-management library — each page's `Model` is self-contained.

### Content script / page bridge

- `button.js` + `button.css`: injected into every Salesforce tab (`content_scripts` in the manifest). Detects it's inside a Salesforce org (checks for `body.sfdcBody`, `ApexCSIPage`, `#auraLoadingBox`, etc.), asks the background page for the session via `getSfHost`/`getSession` messages, then calls `initButton` (in `inspect-inline.js`) to inject the floating Inspector button/UI into the page.
- `background.js`: MV2 background page / MV3 service worker. Owns all `chrome.cookies` access (foreground pages can't reliably read the `sid` cookie across domains/incognito), resolves the right Salesforce session across the various `*.salesforce.com`/`*.force.com`/etc. domains, and proxies outbound AI API calls (`callAIAPI` message) to avoid CORS from page contexts. Also handles the extension toolbar icon click and keyboard shortcuts (`chrome.commands`) which open the relevant tool page.
- `background.js` and `button.js`/`inspect-inline.js` are plain scripts (not ES modules) — see the `.eslintrc.js` overrides — because content scripts / MV2 background scripts can't be loaded as modules.

### Core API layer — `inspector.js`

Exports `sfConn`, the single Salesforce API client used by every page:
- `sfConn.authenticate` / `sfConn.getSession`: OAuth2 PKCE flow and session bootstrap (reads the session either from the background-page cookie lookup or from a completed OAuth redirect); persists tokens in `localStorage` keyed by `sfHost`.
- `sfConn.rest(url, options)`: raw REST API call via `XMLHttpRequest` (supports `normal` and `bulk` auth headers, json/raw/csv/xml bodies, progress/abort handling, and centralized error classification — `Unauthorized`, `SalesforceRestError`, etc.).
- `sfConn.soap(wsdl, method, args)` + the `XML` helper class: builds/parses SOAP envelopes for the Enterprise/Partner/Apex/Metadata/Tooling WSDLs (`sfConn.wsdl(apiVersion, apiName)`).
- Also exports the current `apiVersion` (persisted per-install in `localStorage`, with a `lastApiVersion` bump mechanism).

Any code that talks to Salesforce should go through `sfConn`, not raw `fetch`/`XMLHttpRequest`, to stay consistent with session/error handling.

### Shared feature libraries

- `data-load.js`: shared low-level helpers used by both export and import (Enumerable helpers, `DescribeInfo` metadata cache, clipboard/table utilities).
- `record-table.js`: the reusable results-grid component (`ScrollTable`, `TableModel`, `RecordTable`) used by data export and inspect pages.
- `editor.js`: the custom code/query editor component (autocomplete, syntax highlighting) shared by SOQL/SOSL/Apex inputs — not a third-party editor library.
- `history-box.js`: reusable query/apex history dropdown (`QueryHistory`, `HistoryBox`), backed by `localStorage`.
- `csv-parse.js`: CSV parsing used by data import/export.
- `ai-assistant.js`: wraps calls to OpenAI/Mistral/Anthropic (see `host_permissions` in the manifest) via the background page's `callAIAPI` proxy, used for AI-assisted query/code generation.
- `flamechart/`: a vendored flame-chart-js style library (color utilities, rendering engine) used by the Apex/log profiler view — treat as third-party code.
- `links.js` / `setup-links.js`: builders for deep links into standard Salesforce Setup pages.

### Build/manifest split

There are two hand-maintained manifests, the sources of truth: `addon/manifest-chrome.json` (MV3, `background.service_worker` + `type: module`, `action`, `host_permissions`, split incognito) and `addon/manifest-firefox.json` (MV2, `background.scripts`, `browser_action`, host patterns in `permissions`, spanning incognito, `applications.gecko`). `addon/manifest.json` is only the output of `scripts/dev-build.js` — never edit it directly. **Any manifest change (version bump, new page in `web_accessible_resources`, permission, content script, command) must be made in both files** — nothing checks they stay in sync. `background.js` must keep working in both contexts (e.g. `chrome.action || chrome.browserAction`). `scripts/release-build.js` reuses `dev-build.js`, copies `addon/` to `target/<browser>/dist` (excluding the `manifest-*.json` sources and test files), swaps in minified React, renames the extension with a " BETA" suffix when `ENVIRONMENT_TYPE=BETA`, and zips the result. CI (`.circleci/config.yml`) auto-publishes the Chrome build via `scripts/deploy_to_chrome_web_store.sh`; `.travis.yml` runs lint + both release builds as a check; `.github/workflows/ci.yml` deploys the `docs/` site (mkdocs-material) to GitHub Pages on push to master/main/beta.

## Design principles (from README — keep in mind for any UI/behavior change)

- Stay completely inactive until the user explicitly interacts with it — never alter Salesforce's own behavior just from having the extension installed.
- Manual, ad-hoc tool only — not an automation framework.
- Efficiency over discoverability; advanced features can be hidden, primary features stay central; performance matters.
- Auto-provide contextual info (e.g. autocomplete everywhere) without overwhelming the user.
- Always provide a path to the raw Salesforce API result even if higher-level parsing/enhancement fails.
- Support the widest reasonable range of users/orgs: admins and standard users, person accounts, multi-currency, large data volumes, Professional Edition, slow networks.
- Be conservative with the number/complexity of Salesforce API calls, without sacrificing the above.

## Contribution conventions

- Branch from `master`; PRs target `master`.
- Update `CHANGES.md` describing the fix/improvement as part of any user-facing change.
- If a change adds/alters user-facing functionality, update the corresponding page in `docs/how-to.md` (published via mkdocs to the GitHub Pages docs site).
