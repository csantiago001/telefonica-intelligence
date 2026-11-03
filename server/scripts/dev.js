// Desarrollo: inicia backend (8080) y frontend Vite (5173) en paralelo.
import { spawn } from 'node:child_process';
const run = (cmd, args, cwd) => spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [run('node', ['--disable-warning=ExperimentalWarning', '--watch', 'src/index.js'], 'server'), run('npx', ['vite'], 'client')];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
