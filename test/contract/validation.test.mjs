// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContractCases, requireAssertions } from './validation.mjs';
const cases = [{ id: 'a', steps: [{ name: 'create' }, { name: 'cleanup' }] }];
test('contract selection rejects unknown/empty/duplicate scenarios before network calls', () => {
  assert.throws(() => selectContractCases(cases, ['missing']), /Unknown/);
  assert.throws(() => selectContractCases([], []), /Empty/);
  assert.throws(() => selectContractCases([...cases, ...cases], []), /Duplicate/);
});
test('contract comparison requires an assertion for every selected step including cleanup', () => {
  assert.throws(() => requireAssertions(cases, {}), /Missing/);
  assert.throws(() => requireAssertions(cases, { a: [{ name: 'create', status: 201 }] }), /Missing/);
  assert.throws(() => requireAssertions(cases, { a: [{ name: 'create', status: 201 }, { name: 'cleanup', status: 409, error: 'failed' }] }), /failure/);
  requireAssertions(cases, { a: [{ name: 'create', status: 201 }, { name: 'cleanup', status: 204 }] });
});
