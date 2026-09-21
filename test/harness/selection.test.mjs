// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { executionCases } from '../../.ci/test-catalog.mjs';
import { selectCases, parseOptions, gateProblems } from './selection.mjs';
const catalog = executionCases();
test('default keeps original build/binary/workspace command; full includes gated assets', () => {
  assert.deepEqual(selectCases(catalog, parseOptions([])).map(c => c.command), [['pnpm', 'test:legacy']]);
  const full = selectCases(catalog, parseOptions(['--profile', 'full']));
  assert.ok(full.filter(c => c.runner === 'contract').length >= 11);
  assert.equal(full.filter(c => c.runner === 'node').length, 7);
  assert.ok(full.some(c => c.id === 'st.adapter-real' && gateProblems(c, {}).length));
  assert.ok(full.some(c => c.id === 'st.npu-smoke' && gateProblems(c, {}).length));
});
test('unsupported executors remain selected and blocked; independent work runs once', () => {
  const cases = selectCases(catalog, parseOptions(['--case', 'e2e.child-workspace', '--case', 'ut.host', '--executor', 'both']));
  assert.equal(cases.length, 3);
  assert.match(gateProblems(cases.find(c => c.requestedExecutor === 'jiuwenswarm'), {}).join(), /Unsupported executor/);
});
test('unknown IDs, unknown options and empty filters fail closed', () => {
  assert.throws(() => selectCases(catalog, parseOptions(['--case', 'typo'])), /Unknown case/);
  assert.throws(() => selectCases(catalog, parseOptions(['--capability', 'absent'])), /No test cases/);
  assert.throws(() => parseOptions(['--executor', 'automatic']), /Unknown executor/);
  assert.throws(() => parseOptions(['--layer']), /Missing value/);
});
test('compatibility tag and layer selection share the same identity set', () => {
  const ids = options => selectCases(catalog, parseOptions(options)).map(c => c.id);
  assert.deepEqual(ids(['--tag', 'layer:st']), ids(['--layer', 'st']));
});

test('CI profiles expand configured backends, preserve gates and refuse overrides', () => {
  const pr=selectCases(catalog,parseOptions(['--profile','pr']));
  assert.equal(pr.filter(c=>c.id==='ut.host').length,1);
  assert.ok(pr.filter(c=>c.runner==='playwright').every(c=>c.requestedExecutor==='jiuwenswarm' && c.required));
  assert.throws(()=>selectCases(catalog,parseOptions(['--profile','pr','--executor','native'])),/cannot override/);
  assert.throws(()=>selectCases(catalog,parseOptions(['--profile','pr','--case','st.adapter-real'])),/not in the pr policy/);
  const daily=selectCases(catalog,parseOptions(['--profile','daily']));
  assert.ok(daily.filter(c=>c.runner==='contract').every(c=>!c.required && gateProblems(c,{}).length));
  const full=selectCases(catalog,parseOptions(['--profile','full']));
  assert.ok(full.every(c=>c.required!==false));
});
