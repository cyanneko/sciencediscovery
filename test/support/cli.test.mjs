// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { root } from './discovery.mjs';
const cli = (entry, args) => spawnSync(process.execPath, [join(root, entry), ...args], { cwd: root, encoding: 'utf8', timeout: 20000 });
test('public local and CI list wrappers produce identical selected IDs', () => {
  const args = ['list', '--layer', 'st', '--json'];
  const local = cli('test/support/cli.mjs', args), ci = cli('.ci/test-selector.mjs', args);
  assert.equal(local.status, 0, local.stderr); assert.equal(ci.status, 0, ci.stderr);
  const ids = result => JSON.parse(result.stdout).cases.map(c => [c.id, c.command]);
  assert.deepEqual(ids(local), ids(ci));
});
test('unknown selection fails before starting a process through either entry point', () => {
  for (const entry of ['test/support/cli.mjs', '.ci/test-selector.mjs']) {
    const result = cli(entry, ['run', '--case', 'does-not-exist']);
    assert.equal(result.status, 2); assert.match(result.stderr, /Unknown case/); assert.doesNotMatch(result.stdout, /RUN /);
  }
});
test('the actual Node entry point executes a deep test and propagates its failure', t => {
  const dir = mkdtempSync(join(tmpdir(), 'test-deep-run-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src/one/two/three'), { recursive: true }); mkdirSync(join(dir, 'dist/one/two/three'), { recursive: true });
  writeFileSync(join(dir, 'src/one/two/three/deep.test.ts'), '// source');
  writeFileSync(join(dir, 'dist/one/two/three/deep.test.js'), "require('node:test')('deep sentinel', () => { throw Error('sentinel failure'); });");
  const result = spawnSync(process.execPath, [join(root, 'test/support/node-tests.mjs'), 'compiled'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stdout, /deep sentinel/); assert.match(result.stdout, /sentinel failure/);
});
