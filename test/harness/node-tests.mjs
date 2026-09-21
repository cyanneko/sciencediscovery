// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import { spawnSync } from 'node:child_process';
import { nodeFiles, root, discover } from './discovery.mjs';
try {
  const mode = process.argv[2] ?? 'compiled';
  let files;
  if (mode === 'suite') {
    const { assetSuites } = await import('../../.ci/test-catalog.mjs');
    const ids = process.argv.slice(3);
    if (!ids.length) throw new Error('Choose at least one tooling suite');
    files = ids.flatMap(id => {
      const suite = assetSuites.find(s => s.id === id);
      if (!suite || suite.runner !== 'node:test') throw new Error(`Unknown Node tooling suite: ${id}`);
      return discover(suite);
    });
    if (new Set(files).size !== files.length) throw new Error('Overlapping tooling suites');
  } else files = nodeFiles(process.cwd(), mode);
  if (!files.length) throw new Error('No test files discovered');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // Nested infrastructure checks must start a real, independent Node runner.
  const result = spawnSync(mode === 'web' ? 'tsx' : process.execPath, ['--test', ...(mode === 'suite' ? [] : process.argv.slice(3)), ...files], { stdio: 'inherit', env, ...(mode === 'suite' ? { cwd: root } : {}) });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) { console.error(error.message); process.exitCode = 2; }
