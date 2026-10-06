# QA Orbit

A local QA automation workspace built with React, TypeScript, Node.js, Playwright, and Stagehand. It discovers pages on a website, turns observed page structure into Playwright specs, and lets you run and inspect those specs in a visual workspace.

## Start

Requires Node.js 22.18 or newer.

```powershell
npm.cmd install
npx.cmd playwright install
npm.cmd run dev:server
```

In a second terminal:

```powershell
npm.cmd run dev
```

Open <http://127.0.0.1:5173>. For a built app, run `npm.cmd run build` and `npm.cmd start`, then open <http://127.0.0.1:3001>.

To enable Stagehand semantic analysis, copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and restart the server. Without an API key, Playwright discovery and test generation still work; the UI labels this as Playwright scan mode. The default model is `openai/gpt-5.4-mini`, configurable with `STAGEHAND_MODEL`.

## Workflow

1. Paste an HTTP or HTTPS website URL and choose Quick, Standard, or Deep exploration (up to 3, 10, or 25 pages).
2. Review discovered pages, forms, links, and AI scenario ideas (when Stagehand is configured).
3. Click **Generate tests**. The app writes specs to `tests/<website>/<module>/<submodule>/` in this repository.
4. Run the full suite, a module, a submodule, or an individual test. Results, errors, traces, and screenshots appear in the UI when available.

Discovery stays on the starting origin and does not submit forms or click account-changing controls. Generated cases cover observed page loading, visible forms, required-field validation, and invalid email formats where those elements exist. They are starter automation: review selectors and add authenticated or business-specific assertions before relying on them for regression coverage.

The right chat accepts commands such as a URL to explore, `Generate test cases`, `Run all tests`, `Run Authentication tests`, `Show failed test cases`, and `Sync tests`. It handles these commands locally; open-ended AI chat is not configured.

## Project commands

```powershell
npm.cmd run qa:sync    # Scan tests/ and refresh the UI project tree
npm.cmd run qa:deploy  # Alias for qa:sync; does not publish remotely
npm.cmd test           # Run Playwright directly
npm.cmd run build      # Type-check and build the UI
```

Runtime state is saved in `.data/`, and Playwright artifacts are written to `test-results/`. Both are ignored by Git. Existing test files without the `QA-ORBIT-GENERATED` marker are never overwritten by the generator.
