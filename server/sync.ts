import { syncTests } from './generator.js';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const port = Number(process.env.PORT || 3001);

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/sync`, { method: 'POST', signal: AbortSignal.timeout(1200) });
  if (response.ok) {
    const result = await response.json() as { count: number };
    console.log(`Synced ${result.count} tests with the running QA Orbit UI.`);
    process.exit(0);
  }
} catch { /* server is offline; update the project state on disk */ }
const tests = syncTests();
console.log(`Synced ${tests.length} tests in local project state. Start the server to view them.`);
