import { chromium, type Browser } from '@playwright/test';
import { z } from 'zod';
import { Stagehand, localBrowser } from '@browserbasehq/stagehand';
import { getState, log, setStage, update } from './store.js';
import type { DiscoveredPage } from './types.js';

let activeBrowser: Browser | undefined;
let stopped = false;
let paused = false;
const limits = { quick: 3, standard: 10, deep: 25 };

function checkUrl(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS URL without embedded credentials.');
  return url;
}

export function pauseExploration() { paused = true; update({ paused: true }); log('Exploration paused.'); }
export function resumeExploration() { paused = false; update({ paused: false }); log('Exploration resumed.'); }
export async function stopExploration() {
  stopped = true; paused = false;
  await activeBrowser?.close().catch(() => undefined);
  log('Exploration stopped.');
  update({ running: false, paused: false });
}

async function semanticAnalysis(url: string): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY) return false;
  let browser: Awaited<ReturnType<typeof localBrowser.launch>> | undefined;
  let stagehand: Stagehand | undefined;
  try {
    log('Stagehand is analyzing the page with the configured AI model.');
    browser = await localBrowser.launch({ headless: true, executablePath: chromium.executablePath() });
    stagehand = await Stagehand.create({
      browser,
      model: { modelName: (process.env.STAGEHAND_MODEL || 'openai/gpt-5.4-mini') as 'openai/gpt-5.4-mini', apiKey: process.env.OPENAI_API_KEY },
    });
    const [page] = await browser.context.pages();
    await page.goto(url);
    const schema = z.object({ summary: z.string(), modules: z.array(z.string()), scenarios: z.array(z.string()) });
    const result = await stagehand.extract('Summarize the actual visible page, identify modules and realistic test scenarios. Do not invent pages, features, or credentials.', schema);
    update({ mode: 'stagehand', aiSummary: result.data.summary, aiScenarios: result.data.scenarios });
    log(`Stagehand identified ${result.data.scenarios.length} scenario ideas.`, 'success');
    return true;
  } catch (error) {
    log(`Stagehand analysis unavailable: ${error instanceof Error ? error.message : String(error)}. Browser discovery continues.`, 'error');
    return false;
  } finally {
    await stagehand?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export async function explore(rawUrl: string, depth: 'quick' | 'standard' | 'deep') {
  if (getState().running) throw new Error('A task is already running.');
  const start = checkUrl(rawUrl);
  stopped = false; paused = false;
  const project = start.hostname.replace(/^www\./, '');
  update({ project, url: start.href, depth, mode: 'playwright', running: true, paused: false, pages: [], aiSummary: '', aiScenarios: [], stages: Object.fromEntries(Object.keys(getState().stages).map(key => [key, 'idle'])) });
  setStage('input', 'completed');
  setStage('agent', 'running');
  log(`Starting ${depth} exploration of ${start.origin}.`);
  try {
    setStage('agent', 'completed');
    setStage('browser', 'running');
    activeBrowser = await chromium.launch({ headless: true });
    const context = await activeBrowser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    setStage('browser', 'completed');
    setStage('explore', 'running');
    const queue = [start.href];
    const visited = new Set<string>();
    const pages: DiscoveredPage[] = [];
    while (queue.length && pages.length < limits[depth] && !stopped) {
      while (paused && !stopped) await new Promise(resolve => setTimeout(resolve, 250));
      if (stopped) break;
      const next = queue.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);
      try {
        log(`Opening ${new URL(next).pathname || '/'}…`);
        const response = await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        if (response && response.status() >= 400) { log(`${next} returned HTTP ${response.status()}.`, 'error'); continue; }
        const found = await page.evaluate(() => ({
          title: document.title || location.pathname,
          heading: document.querySelector('h1')?.textContent?.trim() || '',
          links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map(a => a.href),
          buttons: document.querySelectorAll('button, input[type="submit"]').length,
          forms: [...document.querySelectorAll<HTMLFormElement>('form')].map(form => ({
            action: form.getAttribute('action') || location.pathname,
            fields: [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')].map(input => ({ name: input.getAttribute('name') || input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.tagName.toLowerCase(), type: input.getAttribute('type') || input.tagName.toLowerCase(), required: input.hasAttribute('required') })).slice(0, 15),
            buttons: [...form.querySelectorAll('button, input[type="submit"]')].map(button => button.textContent?.trim() || button.getAttribute('value') || 'Submit').slice(0, 8),
          })),
        }));
        const current = new URL(page.url());
        const item: DiscoveredPage = { url: current.href, path: current.pathname, title: found.title, heading: found.heading, links: found.links.length, buttons: found.buttons, forms: found.forms };
        pages.push(item);
        update({ pages: [...pages] });
        log(`Discovered ${item.title} · ${item.forms.length} forms · ${item.links} links.`, 'success');
        for (const href of found.links) {
          try {
            const candidate = new URL(href);
            candidate.hash = '';
            if (candidate.origin === start.origin && ['http:', 'https:'].includes(candidate.protocol) && !visited.has(candidate.href) && !queue.includes(candidate.href) && queue.length < 100) queue.push(candidate.href);
          } catch { /* malformed link */ }
        }
      } catch (error) { log(`Could not inspect ${next}: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
    }
    if (!stopped) {
      setStage('explore', 'completed');
      if (process.env.OPENAI_API_KEY) setStage('analyze', 'running');
      log(`Analyzing ${pages.length} discovered page${pages.length === 1 ? '' : 's'}.`);
      const analyzed = await semanticAnalysis(start.href);
      if (process.env.OPENAI_API_KEY) setStage('analyze', analyzed ? 'completed' : 'failed');
      setStage('scenarios', 'completed');
      log('Exploration complete. Review discoveries, then generate tests.', 'success');
    }
  } catch (error) {
    if (!stopped) { setStage(getState().currentStage, 'failed'); log(error instanceof Error ? error.message : String(error), 'error'); }
  } finally {
    await activeBrowser?.close().catch(() => undefined);
    activeBrowser = undefined;
    update({ running: false, paused: false });
  }
}
