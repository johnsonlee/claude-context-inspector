#!/usr/bin/env node

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, openSync } from 'fs';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(homedir(), '.claude-context-inspector');
const PID_FILE = join(DATA_DIR, 'daemon.pid');
const LOG_FILE = join(DATA_DIR, 'daemon.log');
const SERVER_PATH = join(__dirname, '..', 'dist-server', 'index.js');

// ---------------------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0]; // undefined, 'start', 'stop', 'status'

function parsePort() {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
      const p = Number(args[i + 1]);
      if (Number.isFinite(p) && p > 0 && p < 65536) return p;
      console.error(`Invalid port: ${args[i + 1]}`);
      process.exit(1);
    }
  }
  return 3456;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPid() {
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanStalePid() {
  const pid = readPid();
  if (pid && !isAlive(pid)) {
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

if (!command) {
  // Foreground mode — same as before
  await import('../dist-server/index.js');

} else if (command === 'start') {
  cleanStalePid();
  const existing = readPid();
  if (existing && isAlive(existing)) {
    console.log(`Daemon already running (PID ${existing})`);
    process.exit(0);
  }

  const port = parsePort();
  mkdirSync(DATA_DIR, { recursive: true });
  const logFd = openSync(LOG_FILE, 'a');

  const child = spawn(process.execPath, [SERVER_PATH], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PORT: String(port), DAEMON: '1' },
  });

  child.unref();
  console.log(`Started daemon (PID ${child.pid}) → http://localhost:${port}`);
  console.log(`Log: ${LOG_FILE}`);
  process.exit(0);

} else if (command === 'stop') {
  const pid = readPid();
  if (!pid) {
    console.log('No daemon running (PID file not found)');
    process.exit(0);
  }
  if (!isAlive(pid)) {
    console.log(`Daemon (PID ${pid}) is not running — cleaning up`);
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    process.exit(0);
  }
  process.kill(pid, 'SIGTERM');
  console.log(`Stopped daemon (PID ${pid})`);
  // Give the process a moment to clean up the PID file
  await new Promise(r => setTimeout(r, 500));
  if (existsSync(PID_FILE)) {
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  }

} else if (command === 'status') {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    if (pid) {
      try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    }
    console.log('Not running');
    process.exit(1);
  }
  const port = process.env.PORT || 3456;
  console.log(`Running (PID ${pid}) → http://localhost:${port}`);

} else {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: ccinspector [start|stop|status] [-p PORT]');
  process.exit(1);
}
