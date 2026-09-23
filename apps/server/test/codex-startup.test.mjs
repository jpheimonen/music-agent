import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CodexRunner } from '../dist/codex.js';
import { loadConfig } from '../dist/config.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);

test('default and relative data paths follow the repository root under npm workspace cwd', () => {
  assert.equal(loadConfig({}).dataDir, join(repositoryRoot, 'data'));
  assert.equal(loadConfig({}).codexHome, join(repositoryRoot, 'data', 'codex-home'));
  assert.equal(loadConfig({ MUSIC_DATA_DIR: './private', MUSIC_CODEX_HOME: './custom-home' }).codexHome, join(repositoryRoot, 'custom-home'));
  assert.equal(loadConfig({ MUSIC_DATA_DIR: './private' }).codexHome, join(repositoryRoot, 'private', 'codex-home'));
});

test('npm PATH, explicit CLI shim, and native override pass the real boundary before setup_required', { skip: process.platform !== 'linux', timeout: 60000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'music-codex-startup-'));
  try {
    const shim = await realpath(require.resolve('@openai/codex/bin/codex.js'));
    const native = await realpath(join(dirname(require.resolve(`@openai/codex-linux-${process.arch}/package.json`)), 'vendor', process.arch === 'x64' ? 'x86_64-unknown-linux-musl' : 'aarch64-unknown-linux-musl', 'bin', 'codex'));
    for (const [label, override] of [['npm PATH', undefined], ['explicit shim', shim], ['explicit native', native]]) {
      const config = loadConfig({ MUSIC_DATA_DIR: join(base, label.replace(' ', '-')), MUSIC_CODEX_BIN: override });
      const runner = await CodexRunner.create(config);
      assert.equal(runner.binary, native, `${label}: resolved native binary`);
      assert.equal(runner.runtime, dirname(dirname(native)), `${label}: minimal native runtime grant`);
      assert.deepEqual(runner.capability, { state: 'not_configured', reason: 'setup_required' }, `${label}: boundary passed before isolated login check`);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
