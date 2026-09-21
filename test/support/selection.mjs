// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
export function parseOptions(args) {
  const options = { cases: [], tags: [], excludes: [], capabilities: [] };
  const values = { '--case': 'cases', '--tag': 'tags', '--exclude': 'excludes', '--capability': 'capabilities', '--layer': 'layer', '--surface': 'surface', '--profile': 'profile', '--executor': 'executor' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') continue;
    if (arg === '--json') options.json = true;
    else if (arg === '--fail-fast') options.failFast = true;
    else if (values[arg]) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
      const key = values[arg];
      if (Array.isArray(options[key])) options[key].push(value); else options[key] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.executor && !['native', 'jiuwenswarm', 'both'].includes(options.executor)) throw new Error(`Unknown executor: ${options.executor}`);
  if (options.profile && !['default', 'local', 'full', 'pr', 'daily'].includes(options.profile)) throw new Error(`Unknown profile: ${options.profile}`);
  return options;
}
export function selectCases(catalog, options, action = 'run') {
  const { cases = [], tags = [], excludes = [], capabilities = [] } = options;
  for (const id of [...cases, ...excludes]) if (!catalog.some(c => c.id === id)) throw new Error(`Unknown case: ${id}`);
  const filtered = cases.length || tags.length || options.layer || options.surface || capabilities.length;
  const profile = options.profile ?? (filtered || action !== 'run' ? 'full' : 'default');
  const policyProfile = ['pr', 'daily'].includes(profile);
  if (policyProfile && options.executor) throw new Error('PR/daily executor policy is declared in case YAML; --executor cannot override it');
  for (const id of cases) if (policyProfile && !catalog.find(c => c.id === id)?.ci?.[profile]) throw new Error(`${id} is not in the ${profile} policy`);
  let selected = catalog.filter(c => cases.length ? cases.includes(c.id) :
    policyProfile ? Boolean(c.ci?.[profile]) :
    profile === 'default' ? c.id === 'default.compatibility' :
    profile === 'local' ? ['ut.host', 'st.agent-loop-mocked'].includes(c.id) :
    !['default.compatibility', 'e2e.mocked', 'e2e.real', 'e2e.legacy'].includes(c.id));
  selected = selected.filter(c => !excludes.includes(c.id) && (!options.layer || c.layer === options.layer) &&
    (!options.surface || c.surface === options.surface) && capabilities.every(x => c.capabilities.includes(x)) &&
    tags.every(group => group.split(',').some(tag => (c.tags ?? [`layer:${c.layer}`]).includes(tag))));
  if (!selected.length) throw new Error('No test cases matched; nothing was run');
  // Aggregate and leaf selections must not execute the same browser tests twice.
  for (const group of ['mocked', 'real', 'legacy']) if (selected.some(c => c.id === `e2e.${group}`)) {
    selected = selected.filter(c => !c.id.startsWith('e2e.browser.') || c.command.at(-1) !== group);
  }
  // A combined host/guest invocation builds on the host before entering guest-only work.
  selected.sort((a,b) => (a.id === 'ut.host' ? -2 : a.id === 'ut.guest' ? -1 : 0) - (b.id === 'ut.host' ? -2 : b.id === 'ut.guest' ? -1 : 0));
  return selected.flatMap(c => {
    if (policyProfile) return c.ci[profile].executors.map(executor => ({ ...c, profile, requestedExecutor: executor, required: c.ci[profile].required, policyReason: c.ci[profile].reason }));
    if (!c.executors.length) return [{ ...c, requestedExecutor: 'independent' }];
    return (options.executor === 'both' ? ['native', 'jiuwenswarm'] : [options.executor ?? c.executors[0]])
      .map(executor => ({ ...c, requestedExecutor: executor }));
  });
}
export function gateProblems(c, env = process.env) {
  const errors = [];
  if (c.requestedExecutor !== 'independent' && !c.executors.includes(c.requestedExecutor)) errors.push(`Unsupported executor ${c.requestedExecutor}; supported: ${c.executors.join(', ')}`);
  if (c.gates?.allowEnv && env[c.gates.allowEnv] !== '1') errors.push(`Opt-in required: ${c.gates.allowEnv}=1`);
  for (const name of c.gates?.requiredEnv ?? []) if (!env[name]?.trim()) errors.push(`Missing environment: ${name}`);
  if (c.runner === 'playwright' && c.requestedExecutor === 'jiuwenswarm') {
    for (const name of ['JIUWENSWARM_GATEWAY_URL', 'JIUWENSWARM_MGMT_URL']) if (!env[name]?.trim()) errors.push(`Missing environment: ${name}`);
  }
  if (c.runner === 'contract' && env.E2E_TARGET_EXECUTOR && env.E2E_TARGET_EXECUTOR !== c.requestedExecutor) errors.push('Contract target executor does not match requested executor');
  return errors;
}
