import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { userInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CodexRunner, configuredModel, executionOverrides, modelOverrides } from '../dist/codex.js';
import { loadConfig } from '../dist/config.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);

test('existing Codex home selection and relative data paths follow the documented order', () => {
  assert.equal(loadConfig({}).dataDir, join(repositoryRoot, 'data'));
  assert.equal(loadConfig({}).codexHome, join(userInfo().homedir, '.codex'));
  assert.equal(loadConfig({ CODEX_HOME: '/tmp/existing-codex' }).codexHome, '/tmp/existing-codex');
  assert.equal(loadConfig({ CODEX_HOME: '/tmp/existing-codex', MUSIC_CODEX_HOME: './custom-home' }).codexHome, join(repositoryRoot, 'custom-home'));
  assert.equal(loadConfig({ MUSIC_DATA_DIR: './private', MUSIC_CODEX_HOME: './custom-home' }).codexHome, join(repositoryRoot, 'custom-home'));
});

test('nontrivial personal config is preserved and disabled integrations receive explicit overrides', async () => {
  const base = await mkdtemp(join(tmpdir(), 'music-codex-config-'));
  try {
    const source = 'model="gpt-5"\nnotify=["/bin/false"]\n[mcp_servers.private_tool]\ncommand="/bin/false"\n[profiles.other.mcp_servers.another_tool]\ncommand="/bin/false"\n';
    await writeFile(join(base, 'config.toml'), source);
    const overrides = await executionOverrides(base, join(base, 'scratch'));
    assert.ok(overrides.includes('mcp_servers.private_tool.enabled=false'));
    assert.ok(!overrides.includes('mcp_servers.another_tool.enabled=false'), 'inactive profiles are not applied');
    for (const required of ['notify=[]', 'features.shell_tool=false', 'features.apps=false', 'features.plugins=false', 'features.hooks=false', 'project_doc_max_bytes=0']) assert.ok(overrides.includes(required));
    assert.equal(await readFile(join(base, 'config.toml'), 'utf8'), source);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('pinned CLI sees a configured MCP server as disabled without rewriting config', { skip: process.platform !== 'linux' }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'music-codex-effective-'));
  try {
    const home = join(base, 'home');
    const allowed = join(base, 'allowed');
    await mkdir(home); await mkdir(allowed);
    await writeFile(join(allowed, 'music-instructions.txt'), 'Return only requested JSON. Do not use tools.\n');
    const source = 'model="gpt-5"\nnotify=["/bin/false"]\n[mcp_servers.synthetic]\ncommand="/bin/false"\nargs=[]\n';
    await writeFile(join(home, 'config.toml'), source);
    const native = await realpath(join(dirname(require.resolve(`@openai/codex-linux-${process.arch}/package.json`)), 'vendor', process.arch === 'x64' ? 'x86_64-unknown-linux-musl' : 'aarch64-unknown-linux-musl', 'bin', 'codex'));
    const overrides = await executionOverrides(home, allowed);
    const result = spawnSync(native, [...overrides.flatMap(value => ['-c', value]), 'mcp', 'list', '--json'], {
      cwd: allowed, env: { PATH: process.env.PATH, HOME: userInfo().homedir, CODEX_HOME: home }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, 'pinned CLI accepts the per-invocation configuration');
    const servers = JSON.parse(result.stdout);
    assert.equal(servers.find(server => server.name === 'synthetic')?.enabled, false);
    assert.equal(await readFile(join(home, 'config.toml'), 'utf8'), source);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('music jobs keep a supported personal model and otherwise use the pinned catalog preference', async () => {
  const catalog = { models: [
    { slug: 'hidden-model', visibility: 'hide', priority: 1, default_reasoning_level: 'low' },
    { slug: 'second', visibility: 'list', priority: 5, default_reasoning_level: 'low' },
    { slug: 'preferred', visibility: 'list', priority: 2, default_reasoning_level: 'medium' },
  ] };
  assert.deepEqual(modelOverrides(catalog, 'second'), []);
  assert.deepEqual(modelOverrides(catalog, 'newer-than-the-pinned-cli'), ['model="preferred"', 'model_reasoning_effort="medium"']);
  assert.deepEqual(modelOverrides(catalog, undefined), ['model="preferred"', 'model_reasoning_effort="medium"']);
  assert.throws(() => modelOverrides({ models: [] }, 'x'), /codex_models_unavailable/);
  const base = await mkdtemp(join(tmpdir(), 'music-codex-model-'));
  try {
    assert.equal(await configuredModel(base), undefined);
    await writeFile(join(base, 'config.toml'), 'model="top"\nprofile="work"\n[profiles.work]\nmodel="from-profile"\n');
    assert.equal(await configuredModel(base), 'from-profile');
    await writeFile(join(base, 'config.toml'), 'model="top"\n');
    assert.equal(await configuredModel(base), 'top');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('npm PATH, explicit CLI shim, and native override resolve the native binary and reach the existing-login check', { skip: process.platform !== 'linux', timeout: 60000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'music-codex-startup-'));
  try {
    const shim = await realpath(require.resolve('@openai/codex/bin/codex.js'));
    const native = await realpath(join(dirname(require.resolve(`@openai/codex-linux-${process.arch}/package.json`)), 'vendor', process.arch === 'x64' ? 'x86_64-unknown-linux-musl' : 'aarch64-unknown-linux-musl', 'bin', 'codex'));
    for (const [label, override] of [['npm PATH', undefined], ['explicit shim', shim], ['explicit native', native]]) {
      const home = join(base, label.replace(' ', '-'), 'existing-codex');
      await mkdir(home, { recursive: true });
      const original = 'model="gpt-5"\n[mcp_servers.synthetic]\ncommand="/bin/false"\n';
      await writeFile(join(home, 'config.toml'), original);
      const config = loadConfig({ MUSIC_DATA_DIR: join(base, label.replace(' ', '-')), MUSIC_CODEX_HOME: home, MUSIC_CODEX_BIN: override });
      const runner = await CodexRunner.create(config);
      assert.equal(runner.binary, native, `${label}: resolved native binary`);
      assert.deepEqual(runner.capability, { state: 'not_configured', reason: 'setup_required', authHomeSource: 'MUSIC_CODEX_HOME' }, `${label}: reached the existing-login check`);
      assert.equal(await readFile(join(home, 'config.toml'), 'utf8'), original);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
