// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFiles, inventoryProblems, root } from './discovery.mjs';
function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'test-discovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of files) { const target = join(dir, file); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, ''); }
  return dir;
}
test('recursive Web discovery includes TS and TSX at arbitrary depths', t => {
  const dir = fixture(t, ['tests/a/b/c/deep.test.ts', 'tests/a/view.test.tsx', 'tests/helper.ts']);
  assert.deepEqual(nodeFiles(dir, 'web'), ['tests/a/b/c/deep.test.ts', 'tests/a/view.test.tsx']);
});
test('compiled discovery rejects both missing output and deleted-source stale output', t => {
  const dir = fixture(t, ['src/a/b/c/deep.test.ts']);
  assert.throws(() => nodeFiles(dir), /missing=dist\/a\/b\/c\/deep.test.js/);
  mkdirSync(join(dir, 'dist/a/b/c'), { recursive: true }); writeFileSync(join(dir, 'dist/a/b/c/deep.test.js'), '');
  assert.deepEqual(nodeFiles(dir), ['dist/a/b/c/deep.test.js']);
  writeFileSync(join(dir, 'dist/deleted.test.js'), '');
  assert.throws(() => nodeFiles(dir), /stale=dist\/deleted.test.js/);
});
test('ownership catches orphans, duplicate ownership, stale explicit entries and exclusions', t => {
  const dir = fixture(t, ['tests/a.test.mjs', 'test_orphan.py']);
  const suites = [{ id: 'one', directory: 'tests' }, { id: 'two', files: ['tests/a.test.mjs', 'missing.mjs'] }];
  const errors = inventoryProblems(suites, dir, [{ file: 'gone.py', reason: 'fixture' }]);
  assert.match(errors.join('\n'), /Duplicate ownership/);
  assert.match(errors.join('\n'), /Missing asset: missing/);
  assert.match(errors.join('\n'), /Unowned test: test_orphan/);
  assert.match(errors.join('\n'), /Stale\/undocumented exclusion/);
});
test('migration accounts for retained and explicitly retired browser declarations', () => {
  const migration = JSON.parse(readFileSync(join(root, 'test/harness/migration.json')));
  for (const [source, declarations] of Object.entries({...migration.browserDeclarations, ...migration.upstreamIntegration?.browserDeclarations})) {
    const content = readFileSync(join(root, migration.files[source]), 'utf8');
    const current = [...content.matchAll(/\btest(?:\.(?:skip|fixme|only))?\(\s*(["'`])(.+?)\1/g)].map(m => [m[1], m[2]]);
    for (const declaration of declarations) {
      const retired = (migration.retiredBrowserDeclarations ?? []).find(r => r.source === source && r.title === declaration[1]);
      if (retired) {
        assert.ok(retired.reason && (retired.replacement || retired.coverageGap), 'Retirement needs a reason and replacement or explicit gap');
        assert.ok(!current.some(c => c[1] === declaration[1]), `Stale retirement: ${declaration[1]}`);
      } else assert.ok(current.some(c => c[1] === declaration[1]), `${source}: missing ${declaration[1]}`);
    }
  }
  for (const retired of migration.retiredBrowserDeclarations ?? []) {
    assert.ok(migration.browserDeclarations[retired.source]?.some(d => d[1] === retired.title), 'Retirement must identify an original case');
    if (retired.replacement) assert.ok(readFileSync(join(root, retired.replacement)).length);
  }
  for (const [source, ids] of Object.entries({...migration.contractCases, ...migration.upstreamIntegration?.contractCases})) {
    const current = JSON.parse(readFileSync(join(root, source))).cases.map(c => c.id);
    for (const id of ids) assert.ok(current.includes(id), `Lost scenario: ${id}`);
  }
});
