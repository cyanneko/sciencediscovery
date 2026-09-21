// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
export function selectContractCases(cases, ids) {
  const known = new Set(cases.map(c => c.id));
  if (known.size !== cases.length) throw new Error('Duplicate contract case IDs');
  for (const id of ids) if (!known.has(id)) throw new Error(`Unknown contract case: ${id}`);
  const selected = ids.length ? cases.filter(c => ids.includes(c.id)) : cases;
  if (!selected.length) throw new Error('Empty contract selection');
  return selected;
}
export function requireAssertions(selected, baseline) {
  for (const c of selected) {
    const expected = baseline[c.id];
    if (!Array.isArray(expected) || expected.length !== c.steps.length) throw new Error(`Missing complete baseline assertions: ${c.id}`);
    c.steps.forEach((step, i) => {
      if (expected[i].name !== step.name || !Number.isInteger(expected[i].status)) throw new Error(`Invalid baseline assertion: ${c.id}/${step.name}`);
      if (expected[i].error) throw new Error(`Baseline records a failure: ${c.id}/${step.name}`);
    });
  }
}
