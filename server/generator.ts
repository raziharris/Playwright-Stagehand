import fs from 'node:fs';
import path from 'node:path';
import { getState, log, root, setStage, update } from './store.js';
import type { DiscoveredPage, TestCase } from './types.js';

const marker = '// QA-ORBIT-GENERATED ';
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'home';
const label = (value: string) => value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const literal = (value: string) => JSON.stringify(value);

function fileFor(project: string, module: string, submodule: string, title: string) {
  return path.posix.join('tests', slug(project), slug(module), slug(submodule), `${slug(title)}.spec.ts`);
}
function makeTest(page: DiscoveredPage, project: string, module: string, submodule: string, name: string, purpose: 'load' | 'form' | 'required' | 'email', index?: number): TestCase {
  const file = fileFor(project, module, submodule, name);
  const steps = purpose === 'load' ? [`Open ${page.url}`, 'Wait for the page to finish loading', 'Check that the document has visible content']
    : purpose === 'form' ? [`Open ${page.url}`, `Locate form ${index! + 1}`, 'Verify its visible fields are present']
    : purpose === 'required' ? [`Open ${page.url}`, `Locate form ${index! + 1}`, 'Leave required fields empty', 'Check browser validation rejects the form']
    : [`Open ${page.url}`, `Locate form ${index! + 1}`, 'Enter a malformed email value', 'Check browser validation rejects the value'];
  return { id: file, name, project, module, submodule, file, status: 'NOT RUN', steps,
    expected: purpose === 'load' ? 'Page loads with visible content.' : purpose === 'form' ? 'The discovered form and its fields are present.' : 'Browser validation rejects invalid input.',
    notes: 'Generated from observed page structure. Review selectors and add app-specific assertions where appropriate.' };
}
function script(test: TestCase, page: DiscoveredPage, purpose: 'load' | 'form' | 'required' | 'email', index?: number) {
  const meta = JSON.stringify(test);
  const base = `import { test, expect } from '@playwright/test';\n\ntest(${literal(test.name)}, async ({ page }) => {\n  await page.goto(${literal(page.url)}, { waitUntil: 'domcontentloaded' });\n`;
  let assertion = '';
  if (purpose === 'load') assertion = `  await expect(page.locator('body')).not.toBeEmpty();\n  await expect(page).toHaveURL(${literal(page.url)});\n`;
  if (purpose === 'form') assertion = `  const form = page.locator('form').nth(${index});\n  await expect(form).toBeVisible();\n  await expect(form.locator('input, select, textarea').first()).toBeVisible();\n`;
  if (purpose === 'required') assertion = `  const form = page.locator('form').nth(${index});\n  await expect(form).toBeVisible();\n  expect(await form.evaluate((element: HTMLFormElement) => element.checkValidity())).toBe(false);\n`;
  if (purpose === 'email') assertion = `  const email = page.locator('form').nth(${index}).locator('input[type="email"]').first();\n  await email.fill('not-an-email');\n  expect(await email.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);\n`;
  return `${marker}${meta}\n${base}${assertion}});\n`;
}

export function generateTests() {
  const state = getState();
  if (!state.pages.length) throw new Error('Explore a website before generating tests.');
  if (state.running) throw new Error('Another task is running.');
  setStage('scripts', 'running');
  const generated: TestCase[] = [];
  try {
    for (const page of state.pages) {
      const segments = page.path.split('/').filter(Boolean);
      const module = label(segments[0] || 'Website');
      const submodule = label(segments[1] || 'Pages');
      const pageName = page.heading || page.title || page.path;
      const definitions: { test: TestCase; purpose: 'load' | 'form' | 'required' | 'email'; index?: number }[] = [
        { test: makeTest(page, state.project, module, submodule, `${pageName} loads`, 'load'), purpose: 'load' },
      ];
      page.forms.forEach((form, index) => {
        if (form.fields.length) definitions.push({ test: makeTest(page, state.project, module, submodule, `${pageName} form ${index + 1} is present`, 'form', index), purpose: 'form', index });
        if (form.fields.some(field => field.required)) definitions.push({ test: makeTest(page, state.project, module, submodule, `${pageName} form ${index + 1} rejects empty required fields`, 'required', index), purpose: 'required', index });
        if (form.fields.some(field => field.type === 'email')) definitions.push({ test: makeTest(page, state.project, module, submodule, `${pageName} form ${index + 1} rejects invalid email`, 'email', index), purpose: 'email', index });
      });
      for (const entry of definitions) {
        const fullPath = path.resolve(root, entry.test.file);
        if (fs.existsSync(fullPath) && !fs.readFileSync(fullPath, 'utf8').startsWith(marker)) {
          log(`Skipped ${entry.test.file}: existing file is not generated by QA Orbit.`, 'error');
          continue;
        }
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, script(entry.test, page, entry.purpose, entry.index));
        generated.push(entry.test);
      }
    }
    syncTests();
    setStage('scripts', 'completed');
    log(`Generated ${generated.length} Playwright tests in tests/${slug(state.project)}/.`, 'success');
    return generated;
  } catch (error) { setStage('scripts', 'failed'); throw error; }
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.isFile() && entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

export function syncTests() {
  const old = new Map(getState().tests.map(test => [test.id, test]));
  const tests: TestCase[] = [];
  for (const full of walk(path.join(root, 'tests'))) {
    const contents = fs.readFileSync(full, 'utf8');
    const relative = path.relative(root, full).replaceAll('\\', '/');
    const meta = contents.startsWith(marker) ? contents.slice(marker.length).split('\n')[0] : '';
    try {
      const parsed = JSON.parse(meta) as TestCase;
      const previous = old.get(relative);
      tests.push({ ...parsed, id: relative, file: relative, status: previous?.status || parsed.status, duration: previous?.duration, error: previous?.error, lastRun: previous?.lastRun });
    } catch {
      const parts = relative.split('/');
      tests.push({ id: relative, file: relative, name: label(path.basename(full, '.spec.ts')), project: parts[1] || 'Project', module: label(parts[2] || 'Tests'), submodule: label(parts[3] || 'General'), status: old.get(relative)?.status || 'NOT RUN', steps: [], expected: 'Review the test script.', notes: 'Imported from a project test file.' });
    }
  }
  update({ tests: tests.sort((a, b) => a.file.localeCompare(b.file)) });
  return tests;
}
