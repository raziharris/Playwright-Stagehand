import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const binary = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(binary, ['.'], { stdio: 'inherit', env, windowsHide: false });
child.on('exit', code => process.exit(code || 0));
