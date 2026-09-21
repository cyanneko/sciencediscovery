#!/usr/bin/env node
// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assetSuites, assetExclusions, executionCases, tagDimensions } from '../../.ci/test-catalog.mjs';
import { assertCiContract } from '../../.ci/ci-contract.mjs';
import { root, discover, inventoryProblems } from './discovery.mjs';
import { parseOptions, selectCases } from './selection.mjs';
import { manifestCoverageProblems } from './manifests.mjs';
import { preflight, runSelected } from './runner.mjs';
export async function main(args = process.argv.slice(2)) {
  const [action = 'run', ...rest] = args;
  const options = parseOptions(rest);
  if (!['run', 'list', 'check', 'doctor', 'tags'].includes(action)) throw new Error(`Unknown action: ${action}`);
  if (!options.executor && !['pr','daily'].includes(options.profile) && process.env.CI_E2E_BACKEND) {
    const executor = {legacy:'native',jiuwenswarm:'jiuwenswarm'}[process.env.CI_E2E_BACKEND];
    if (!executor) throw new Error('CI_E2E_BACKEND must be legacy or jiuwenswarm');
    options.executor = executor;
  }
  const catalog = executionCases();
  if (action === 'tags') { console.log(JSON.stringify(tagDimensions, null, 2)); return 0; }
  if (action === 'check') {
    await assertCiContract();
    const problems = [...inventoryProblems(assetSuites, root, assetExclusions), ...manifestCoverageProblems({cases:catalog,suites:assetSuites})];
    const ids = new Set();
    for (const c of catalog) {
      if (ids.has(c.id)) problems.push(`Duplicate case: ${c.id}`);
      ids.add(c.id);
      if (c.source && !existsSync(join(root, c.source))) problems.push(`Missing case source: ${c.source}`);
      for (const field of ['owner', 'runner', 'layer', 'surface', 'timeoutMs']) if (!c[field]) problems.push(`${c.id}: missing ${field}`);
    }
    const meta = spawnSync(process.execPath, ['test/check-e2e-meta.mjs'], { cwd: root, encoding: 'utf8' });
    if (meta.status !== 0) problems.push(meta.stdout + meta.stderr);
    if (problems.length) throw new Error(problems.join('\n'));
    console.log(`Catalog OK: ${catalog.length} executable entries; ${assetSuites.reduce((n, s) => n + discover(s).length, 0)} static assets in ${assetSuites.length} suites (not framework-expanded case counts)`);
    return 0;
  }
  const selected = selectCases(catalog, options, action);
  if (action === 'run') return (await runSelected(selected, { failFast: options.failFast })).exitCode;
  const cases = selected.map(c => ({ ...c, blocked: preflight(c), staticAssets: c.source ? 1 : null }));
  const suites = assetSuites.map(s => ({ ...s, files: discover(s), staticAssetCount: discover(s).length }));
  if (options.json) console.log(JSON.stringify({ cases, suites, countKind: 'static assets; use framework collection for expanded cases' }, null, 2));
  else {
    for (const c of cases) console.log(`${c.id} [${c.requestedExecutor}; ${c.required === false ? 'observational' : 'required'}] ${c.blocked.length ? 'BLOCKED: ' + c.blocked.join('; ') : 'READY (runtime not yet verified)'}\n  ${c.command.join(' ')}`);
    console.log(`${cases.length} selected entries; ${suites.reduce((n, s) => n + s.staticAssetCount, 0)} static assets. Listing does not execute tests.`);
  }
  return action === 'doctor' && cases.some(c => c.blocked.length) ? 2 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
