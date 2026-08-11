/**
 * `npm run dev:local` — the frontend plus its local stand-in API, one command.
 *
 * Development only. `scripts/dev-api.mjs` authenticates anybody, so this wiring
 * must never be used for anything but local work. Runs both children, prefixes
 * their output, and takes the whole group down if either exits.
 *
 * Deliberately dependency-free (no `concurrently`) — a dev convenience isn't
 * worth another entry in the lockfile.
 */
import { spawn } from 'node:child_process';

const API_PORT = process.env.DEV_API_PORT ?? '8001';
const API_URL = `http://127.0.0.1:${API_PORT}`;

const children = [];
let shuttingDown = false;

function run(name, colour, command, args, env) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const tag = `[${colour}m[${name}][0m`;
  const pipe = (stream) => {
    stream.setEncoding('utf8');
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) console.log(`${tag} ${line}`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`${tag} exited (${code}) — stopping the others.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', '35', process.execPath, ['scripts/dev-api.mjs', API_PORT]);
run('web', '36', 'npx', ['next', 'dev'], { PAPERMIND_API_URL: API_URL });

console.log(`\n  Frontend  http://localhost:3000\n  Local API ${API_URL}  (development only — authenticates anybody)\n  Sign in with any email and any password.\n`);
