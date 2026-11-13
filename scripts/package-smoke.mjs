import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-request-logger-package-'));
let child;
let upstream;
try {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], { encoding: 'utf8' }));
  assert(packed.files.some(f => f.path === 'dist/main.js'));
  assert(!packed.files.some(f => /(?:\.test\.|^e2e\/|^logs\/|^request-logger-logs\/|agent-choice)/.test(f.path)));
  fs.writeFileSync(path.join(scratch, 'package.json'), '{"private":true}');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', path.join(scratch, packed.filename)], { cwd: scratch, stdio: 'pipe' });
  const bin = path.join(scratch, 'node_modules', '.bin', 'agent-request-logger');
  assert(execFileSync(bin, ['--help'], { encoding: 'utf8' }).includes('--log-dir'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim(), pkg.version);
  assert.throws(() => execFileSync(bin, ['--port', '0'], { stdio: 'pipe' }));
  const config = path.join(scratch, 'preferences');
  fs.mkdirSync(config);
  fs.writeFileSync(path.join(config, '.agent-choice.json'), JSON.stringify({ agent: 'codex', provider: 'openai' }));
  let body = '';
  let auth;
  upstream = http.createServer((req, res) => {
    auth = req.headers.authorization;
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'test', output: [], usage: { input_tokens: 1, output_tokens: 0 } }));
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let output = '';
  child = spawn(bin, ['--port', String(port), '--config-dir', config], {
    cwd: scratch,
    env: { ...process.env, REQUEST_LOGGER_LOG_DIR: '', REQUEST_LOGGER_TEST_DIR: '', REQUEST_LOGGER_TEST_UPSTREAM: `http://127.0.0.1:${upstream.address().port}`, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', c => { output += c; });
  child.stderr.on('data', c => { output += c; });
  for (let i = 0; i < 100 && !output.includes('Ctrl+C'); i++) {
    if (child.exitCode !== null) throw new Error(output);
    await delay(100);
  }
  assert(output.includes('Ctrl+C'), output);
  const payload = JSON.stringify({ model: 'test', input: 'package-smoke-prompt' });
  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer smoke-secret' }, body: payload,
  });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(body, payload);
  assert.equal(auth, 'Bearer smoke-secret');
  const logs = path.join(scratch, 'request-logger-logs');
  for (let i = 0; i < 50 && !fs.existsSync(logs); i++) await delay(100);
  const files = fs.readdirSync(logs);
  assert.equal(files.length, 3);
  const capture = fs.readFileSync(path.join(logs, files.find(f => f.endsWith('.md'))), 'utf8');
  assert(capture.includes('package-smoke-prompt'));
  assert(!capture.includes('smoke-secret'));
  assert(capture.includes('[REDACTED]'));
  console.log('Packed CLI: clean install, executable, options, forwarding, redaction, launch-directory captures passed.');
} finally {
  if (child && child.exitCode === null) {
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await stopped;
  }
  if (upstream) await new Promise(resolve => upstream.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
}
