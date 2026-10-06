import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { getState, log, root, setStage, update } from './store.js';
import type { TestCase } from './types.js';

let child: ChildProcess | undefined;
export function stopRun() { if (child) { child.kill(); log('Test run stopped.'); } }

type Scope = { level: 'all' | 'module' | 'submodule' | 'test'; value?: string };
export async function runTests(scope: Scope) {
  const state = getState();
  if (state.running) throw new Error('A task is already running.');
  const selected = state.tests.filter(test => scope.level === 'all' || (scope.level === 'module' && test.module === scope.value) || (scope.level === 'submodule' && `${test.module}/${test.submodule}` === scope.value) || (scope.level === 'test' && test.id === scope.value));
  if (!selected.length) throw new Error('No tests match that selection.');
  const ids = new Set(selected.map(test => test.id));
  const started = Date.now();
  update({ running: true, tests: state.tests.map(test => ids.has(test.id) ? { ...test, status: 'QUEUED', error: undefined } : test) });
  setStage('execute', 'running');
  log(`Running ${selected.length} test${selected.length === 1 ? '' : 's'} · ${scope.level === 'all' ? 'full suite' : scope.value}.`);
  const args = [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', ...selected.map(test => test.file), '--workers=2'];
  const resultPath = path.join(root, '.data', 'latest-results.json');
  try {
    if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
    await new Promise<void>((resolve, reject) => {
      child = spawn(process.execPath, args, { cwd: root, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
      let output = '';
      const receive = (chunk: Buffer) => {
        output += chunk.toString();
        const lines = output.split(/\r?\n/);
        output = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('QA_EVENT:')) {
            try {
              const event = JSON.parse(line.slice('QA_EVENT:'.length));
              const id = path.relative(root, event.file).replaceAll('\\', '/');
              update({ tests: getState().tests.map(test => test.id === id ? { ...test, status: event.kind === 'begin' ? 'RUNNING' : event.status === 'passed' ? 'PASS' : 'FAIL', duration: event.duration, error: event.error, lastRun: event.kind === 'end' ? new Date().toISOString() : test.lastRun } : test) });
              if (event.kind === 'end') log(`${event.status === 'passed' ? 'PASS' : 'FAIL'} · ${event.title}`, event.status === 'passed' ? 'success' : 'error');
            } catch { /* final JSON report remains the source of truth */ }
          } else if (line.trim() && (/\d+\s+passed|\d+\s+failed|\[\d+\/\d+\]/.test(line))) log(line.trim().slice(0, 220));
        }
      };
      child.stdout?.on('data', receive);
      child.stderr?.on('data', receive);
      child.once('error', reject);
      child.once('close', () => resolve());
    });
    const outcomes = new Map<string, { status: TestCase['status']; duration: number; error?: string; artifacts: TestCase['artifacts'] }>();
    if (fs.existsSync(resultPath)) {
      const report = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      function collect(suite: any, inheritedFile?: string) {
        const file = suite.file || inheritedFile;
        for (const spec of suite.specs || []) {
          const specFile = (spec.file || file || '').replaceAll('\\', '/');
          const test = (getState().tests.find(item => item.file === specFile) || getState().tests.find(item => item.file.endsWith(specFile))) as TestCase | undefined;
          if (!test) continue;
          const results = (spec.tests || []).flatMap((entry: any) => entry.results || []);
          const failed = results.some((entry: any) => entry.status !== 'passed');
          outcomes.set(test.id, { status: failed ? 'FAIL' : 'PASS', duration: results.reduce((sum: number, entry: any) => sum + (entry.duration || 0), 0),
            error: results.find((entry: any) => entry.error)?.error?.message,
            artifacts: results.flatMap((entry: any) => entry.attachments || []).filter((item: any) => item.path).map((item: any) => ({ name: item.name, path: path.relative(root, path.resolve(root, item.path)).replaceAll('\\', '/') })) });
        }
        for (const nested of suite.suites || []) collect(nested, file);
      }
      for (const suite of report.suites || []) collect(suite);
    }
    const now = new Date().toISOString();
    const tests = getState().tests.map(test => {
      if (!ids.has(test.id)) return test;
      const outcome = outcomes.get(test.id);
      return { ...test, status: outcome?.status || 'FAIL', duration: outcome?.duration, error: outcome?.error || (!outcome ? 'No result was produced; see server logs.' : undefined), artifacts: outcome?.artifacts, lastRun: now };
    });
    const passed = tests.filter(test => ids.has(test.id) && test.status === 'PASS').length;
    const failed = selected.length - passed;
    update({ tests, history: [{ id: crypto.randomUUID(), time: now, scope: scope.level === 'all' ? 'Full suite' : scope.value || scope.level, passed, failed, total: selected.length, duration: Date.now() - started }, ...getState().history].slice(0, 40) });
    setStage('execute', failed ? 'failed' : 'completed');
    setStage('report', 'completed');
    log(`Run finished · ${passed} passed · ${failed} failed.`, failed ? 'error' : 'success');
  } catch (error) {
    setStage('execute', 'failed');
    log(`Test runner error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    throw error;
  } finally { child = undefined; update({ running: false }); }
}
