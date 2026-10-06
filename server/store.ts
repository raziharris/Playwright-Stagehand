import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { stageIds, type AppState, type EventLog, type TestCase } from './types.js';

export const root = process.cwd();
export const dataDir = path.join(root, '.data');
const stateFile = path.join(dataDir, 'state.json');
fs.mkdirSync(dataDir, { recursive: true });

const initial: AppState = {
  project: '', url: '', depth: 'standard', mode: 'playwright', running: false, paused: false,
  stages: Object.fromEntries(stageIds.map(id => [id, 'idle'])), currentStage: '',
  pages: [], tests: [], logs: [], history: [], aiSummary: '', aiScenarios: [],
};
let state: AppState = fs.existsSync(stateFile) ? { ...initial, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) } : initial;
state.running = false;
state.paused = false;
let clients = new Set<Response>();

export function getState() { return state; }
export function save() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  for (const client of clients) client.write(`data: ${JSON.stringify(state)}\n\n`);
}
export function update(patch: Partial<AppState>) { state = { ...state, ...patch }; save(); }
export function subscribe(response: Response) {
  clients.add(response);
  response.write(`data: ${JSON.stringify(state)}\n\n`);
  response.on('close', () => clients.delete(response));
}
export function log(message: string, type: EventLog['type'] = 'info') {
  state.logs = [{ id: crypto.randomUUID(), time: new Date().toISOString(), type, message }, ...state.logs].slice(0, 160);
  save();
}
export function setStage(id: string, status: 'idle' | 'running' | 'completed' | 'failed') {
  state.stages[id] = status;
  if (status === 'running') state.currentStage = id;
  save();
}
export function upsertTest(test: TestCase) {
  state.tests = [...state.tests.filter(item => item.id !== test.id), test].sort((a, b) => a.file.localeCompare(b.file));
  save();
}
