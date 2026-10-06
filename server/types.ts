export type TestStatus = 'NOT RUN' | 'QUEUED' | 'RUNNING' | 'PASS' | 'FAIL';
export type StageStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface DiscoveredForm { action: string; fields: { name: string; type: string; required: boolean }[]; buttons: string[] }
export interface DiscoveredPage {
  url: string; path: string; title: string; heading: string;
  links: number; buttons: number; forms: DiscoveredForm[];
}
export interface TestCase {
  id: string; name: string; project: string; module: string; submodule: string;
  file: string; status: TestStatus; duration?: number; error?: string;
  steps: string[]; expected: string; notes: string; lastRun?: string; artifacts?: { name: string; path: string }[];
}
export interface EventLog { id: string; time: string; type: 'info' | 'success' | 'error'; message: string }
export interface RunHistory { id: string; time: string; scope: string; passed: number; failed: number; total: number; duration: number }
export interface AppState {
  project: string; url: string; depth: 'quick' | 'standard' | 'deep';
  mode: 'playwright' | 'stagehand'; running: boolean; paused: boolean;
  stages: Record<string, StageStatus>; currentStage: string;
  pages: DiscoveredPage[]; tests: TestCase[]; logs: EventLog[];
  history: RunHistory[]; aiSummary: string; aiScenarios: string[];
}

export const stageIds = ['input', 'agent', 'browser', 'explore', 'analyze', 'scenarios', 'scripts', 'execute', 'report'] as const;
