import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { explore, pauseExploration, resumeExploration, stopExploration } from './explorer.js';
import { generateTests, syncTests } from './generator.js';
import { runTests, stopRun } from './runner.js';
import { getState, log, root, subscribe } from './store.js';

const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const app = express();
app.use(express.json({ limit: '32kb' }));
syncTests();

app.get('/api/state', (_req, res) => res.json({ ...getState(), stagehandConfigured: Boolean(process.env.OPENAI_API_KEY) }));
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  subscribe(res);
});
app.get('/api/test', (req, res) => {
  const test = getState().tests.find(item => item.id === req.query.id);
  if (!test) return res.status(404).json({ error: 'Test not found.' });
  const file = path.resolve(root, test.file);
  if (!file.startsWith(path.join(root, 'tests') + path.sep)) return res.status(400).json({ error: 'Invalid test path.' });
  res.json({ test, script: fs.readFileSync(file, 'utf8') });
});
app.get('/api/artifact', (req, res) => {
  const artifact = String(req.query.path || '');
  const full = path.resolve(root, artifact);
  if (!full.startsWith(path.join(root, 'test-results') + path.sep) || !fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});
app.post('/api/explore', (req, res) => {
  const { url, depth = 'standard' } = req.body || {};
  if (typeof url !== 'string' || !['quick', 'standard', 'deep'].includes(depth)) return res.status(400).json({ error: 'Provide a valid URL and exploration depth.' });
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
  catch { return res.status(400).json({ error: 'Enter a valid HTTP or HTTPS URL.' }); }
  if (getState().running) return res.status(409).json({ error: 'A task is already running.' });
  void explore(url, depth).catch(error => log(`Exploration failed: ${String(error)}`, 'error'));
  res.status(202).json({ message: 'Exploration started.' });
});
app.post('/api/pause', (_req, res) => { if (!getState().running) return res.status(409).json({ error: 'No exploration is running.' }); pauseExploration(); res.json({ message: 'Paused.' }); });
app.post('/api/resume', (_req, res) => { resumeExploration(); res.json({ message: 'Resumed.' }); });
app.post('/api/stop', async (_req, res) => { if (getState().currentStage === 'execute') stopRun(); else await stopExploration(); res.json({ message: 'Stopped.' }); });
app.post('/api/generate', (_req, res) => { try { res.json({ tests: generateTests() }); } catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); } });
app.post('/api/sync', (_req, res) => { const tests = syncTests(); log(`Synced ${tests.length} project tests.`, 'success'); res.json({ count: tests.length }); });
app.post('/api/run', (req, res) => {
  const { level, value } = req.body || {};
  if (!['all', 'module', 'submodule', 'test'].includes(level)) return res.status(400).json({ error: 'Invalid run scope.' });
  if (getState().running) return res.status(409).json({ error: 'A task is already running.' });
  void runTests({ level, value }).catch(error => log(`Run failed: ${String(error)}`, 'error'));
  res.status(202).json({ message: 'Test run started.' });
});
app.post('/api/chat', (req, res) => {
  const message = String(req.body?.message || '').trim();
  const url = message.match(/https?:\/\/[^\s]+/i)?.[0];
  if (url) {
    if (getState().running) return res.status(409).json({ error: 'A task is already running.' });
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
    catch { return res.status(400).json({ error: 'Enter a valid HTTP or HTTPS URL.' }); }
    void explore(url, getState().depth).catch(error => log(String(error), 'error'));
    return res.json({ reply: `I’ll explore ${url}. Progress will appear in the activity feed.` });
  }
  if (/show failed/i.test(message)) {
    const failed = getState().tests.filter(test => test.status === 'FAIL');
    return res.json({ reply: failed.length ? failed.map(test => `• ${test.name}`).join('\n') : 'There are no failed test cases in the current results.' });
  }
  if (/sync|deploy/i.test(message)) { const tests = syncTests(); return res.json({ reply: `Synced ${tests.length} test files from this project.` }); }
  if (/generat|regenerat|negative/i.test(message)) {
    try { const tests = generateTests(); return res.json({ reply: `Generated ${tests.length} tests from observed pages, including negative validation checks where forms expose required or email fields.` }); }
    catch (error) { return res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
  }
  if (/run|regression/i.test(message)) {
    if (getState().running) return res.status(409).json({ error: 'A task is already running.' });
    const named = getState().tests.find(test => message.toLowerCase().includes(test.name.toLowerCase()));
    const module = [...new Set(getState().tests.map(test => test.module))].find(name => message.toLowerCase().includes(name.toLowerCase()));
    const scope = named ? { level: 'test' as const, value: named.id } : module ? { level: 'module' as const, value: module } : { level: 'all' as const };
    void runTests(scope).catch(error => log(String(error), 'error'));
    return res.json({ reply: named ? `Running ${named.name}.` : module ? `Running ${module} tests.` : 'Running the full test suite.' });
  }
  return res.json({ reply: 'I can explore a URL, generate tests, run a test or module, show failed tests, and sync project tests. For semantic AI analysis, add OPENAI_API_KEY to .env.' });
});

const dist = process.env.QA_ORBIT_DIST_DIR || path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => console.log(`QA Orbit API ready at http://127.0.0.1:${port}`));
