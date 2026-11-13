import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

test('في الإنتاج لا يبدأ الخادم دون ADMIN_PASSWORD', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taif-start-'));
  const env = { ...process.env, NODE_ENV: 'production', DATA_DIR: dir, PORT: '0' };
  delete env.ADMIN_PASSWORD;
  const r = spawnSync(process.execPath, [entry], { env, encoding: 'utf8', timeout: 10_000 });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ADMIN_PASSWORD/);
  assert.ok(!fs.existsSync(path.join(dir, 'platform.db')));
});
