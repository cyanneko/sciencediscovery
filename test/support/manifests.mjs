// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { parseDocument } from 'yaml';
import { root, walk, discover } from './discovery.mjs';
const EXECUTORS = ['native', 'jiuwenswarm'];
const CASE_KEYS = ['version','id','source','owner','description','layer','surface','runner','capabilities','llm','supportedExecutors','timeoutSeconds','requirements','gates','ci','tags','quarantine','scenarioId','command','resultPath','compatibility','reporting'];
const SUITE_KEYS = ['version','id','directory','files','owner','runner','layer','entryPoint','discovery','exclude','excludeDirectories'];
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label}: expected an object`);
  const unknown = Object.keys(value).filter(k => !keys.includes(k));
  if (unknown.length) throw Error(`${label}: unknown fields ${unknown.join(', ')}`);
}
function string(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${label}: expected a nonempty string`);
}
function strings(value, label, allowed) {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim()) || new Set(value).size !== value.length) throw Error(`${label}: expected unique strings`);
  if (allowed && value.some(v => !allowed.includes(v))) throw Error(`${label}: unsupported value`);
}
function choice(value, values, label) { if (!values.includes(value)) throw Error(`${label}: expected ${values.join(' | ')}`); }
function pathAt(file, value, directory) {
  string(value, `${file}: path`);
  if (isAbsolute(value)) throw Error(`${file}: paths must be relative`);
  const path = relative(directory, resolve(directory, dirname(file), value)).replaceAll('\\', '/');
  if (path === '..' || path.startsWith('../')) throw Error(`${file}: path escapes repository`);
  if (!existsSync(join(directory, path))) throw Error(`${file}: missing path ${path}`);
  return path || '.';
}
export function readManifest(file, directory = root) {
  const document = parseDocument(readFileSync(join(directory, file), 'utf8'), { uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw Error(`${file}: invalid YAML: ${[...document.errors, ...document.warnings].map(e => e.message).join('; ')}`);
  const value = document.toJS({ maxAliasCount: 0 });
  object(value, file.endsWith('.case.yaml') ? CASE_KEYS : SUITE_KEYS, file);
  if (value.version !== 1) throw Error(`${file}: version must be 1`);
  for (const field of ['id','owner','runner','layer']) string(value[field], `${file}: ${field}`);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9_-]+)*$/.test(value.id)) throw Error(`${file}: invalid id`);
  return value;
}
export function normalizeCase(value, file, directory = root) {
  object(value, CASE_KEYS, file);
  choice(value.layer, ['ut','st','e2e'], `${file}: layer`);
  choice(value.surface, ['browser','api','process'], `${file}: surface`);
  choice(value.runner, ['layer','pnpm','playwright','node','pytest','contract'], `${file}: runner`);
  if (value.reporting !== undefined) choice(value.reporting, ['steps'], `${file}: reporting`);
  strings(value.capabilities, `${file}: capabilities`);
  strings(value.supportedExecutors, `${file}: supportedExecutors`, EXECUTORS);
  strings(value.requirements, `${file}: requirements`, ['build','clean-worktree','contract-target']);
  if (!Number.isFinite(value.timeoutSeconds) || value.timeoutSeconds <= 0) throw Error(`${file}: timeoutSeconds must be positive`);
  string(value.resultPath, `${file}: resultPath`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value.resultPath)) throw Error(`${file}: invalid resultPath`);
  object(value.llm, ['mode'], `${file}: llm`);
  choice(value.llm.mode, ['none','stub','real','unreviewed'], `${file}: llm.mode`);
  object(value.ci, ['pr','daily'], `${file}: ci`);
  for (const [profile, policy] of Object.entries(value.ci)) {
    object(policy, ['executors','required','reason'], `${file}: ci.${profile}`);
    strings(policy.executors, `${file}: ci.${profile}.executors`, value.supportedExecutors.length ? value.supportedExecutors : ['independent']);
    if (!policy.executors.length || typeof policy.required !== 'boolean') throw Error(`${file}: policy needs executors and boolean required`);
    if (!policy.required) string(policy.reason, `${file}: nonblocking policy reason`);
  }
  if (value.gates) {
    object(value.gates, ['allowEnv','requiredEnv'], `${file}: gates`);
    string(value.gates.allowEnv, `${file}: gates.allowEnv`);
    strings(value.gates.requiredEnv, `${file}: gates.requiredEnv`);
    for (const name of [value.gates.allowEnv, ...value.gates.requiredEnv]) if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw Error(`${file}: invalid environment variable name`);
  }
  if (value.llm.mode === 'real' && value.gates?.allowEnv !== 'CI_ALLOW_REAL') throw Error(`${file}: real LLM requires CI_ALLOW_REAL gate`);
  if (value.quarantine) { object(value.quarantine, ['reason'], `${file}: quarantine`); string(value.quarantine.reason, `${file}: quarantine reason`); }
  if ((value.quarantine || value.llm.mode === 'unreviewed') && (value.gates?.allowEnv !== 'CI_ALLOW_LEGACY' || !value.quarantine)) throw Error(`${file}: unreviewed/quarantined tests need reason and CI_ALLOW_LEGACY gate`);
  if ((value.quarantine || value.llm.mode === 'real') && value.ci.pr) throw Error(`${file}: PR policy must be deterministic and reviewed`);
  if (value.tags) {
    strings(value.tags, `${file}: tags`);
    if (value.tags.some(t => /^(llm|layer):/.test(t))) throw Error(`${file}: layer/llm tags are derived, not duplicated`);
  }
  if (value.compatibility) {
    object(value.compatibility, ['command'], `${file}: compatibility`);
    strings(value.compatibility.command, `${file}: compatibility.command`);
  }
  const source = value.source ? pathAt(file, value.source, directory) : undefined;
  if (source && !statSync(join(directory, source)).isFile()) throw Error(`${file}: source must be a file`);
  if (!source && !['layer','pnpm','playwright'].includes(value.runner)) throw Error(`${file}: source is required`);
  let command, env, group;
  switch (value.runner) {
    case 'playwright': {
      group = value.quarantine ? 'legacy' : value.llm.mode === 'real' ? 'real' : 'mocked';
      if (value.surface !== 'browser' || value.layer !== 'e2e') throw Error(`${file}: browser runner requires e2e/browser`);
      if (source && (!source.startsWith('test/e2e/') || !source.endsWith('.spec.ts'))) throw Error(`${file}: browser source outside spec directory`);
      command = ['bash','.ci/run-e2e.sh',group];
      if (source) env = { CI_E2E_SPEC: '(^|/)' + source.slice('test/e2e/'.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$' };
      break;
    }
    case 'node': command = ['node',source]; break;
    case 'pytest': command = ['uv','run','--project','services/adapter','--extra','test','pytest',source]; break;
    case 'contract': {
      string(value.scenarioId, `${file}: scenarioId`);
      const scenarios = JSON.parse(readFileSync(join(directory, source),'utf8')).cases;
      if (!scenarios.some(c => c.id === value.scenarioId)) throw Error(`${file}: unknown contract scenario ${value.scenarioId}`);
      command = ['node','test/support/contract/run.mjs','--case',value.scenarioId,'--compare-env']; break;
    }
    default:
      if (!Array.isArray(value.command) || !value.command.length || value.command.some(v => typeof v !== 'string' || !v)) throw Error(`${file}: command must be nonempty argv`);
      command = value.command;
  }
  if (!['layer','pnpm'].includes(value.runner) && value.command) throw Error(`${file}: command is generated by runner`);
  return { ...value, source, configPath: file, executors: value.supportedExecutors, timeoutMs: value.timeoutSeconds * 1000,
    command, ...(group ? {group} : {}), ...(env ? {env}:{}), tags: [...(value.tags ?? []), `layer:${value.layer}`,`llm:${value.llm.mode}`] };
}
export function loadManifests(directory = root) {
  const cases = [], suites = [], ids = new Set(), sourceOwners = new Set();
  for (const file of walk(directory).filter(f => /\.(case|suite)\.yaml$/.test(f))) {
    const value = readManifest(file, directory);
    if (ids.has(value.id)) throw Error(`${file}: duplicate id ${value.id}`);
    ids.add(value.id);
    if (file.endsWith('.case.yaml')) {
      const c = normalizeCase(value,file,directory);
      if (c.source) {
        const key = `${c.source}#${c.scenarioId ?? ''}`;
        if (sourceOwners.has(key)) throw Error(`${file}: duplicate source ownership ${key}`);
        sourceOwners.add(key);
      }
      cases.push(c);
    } else {
      choice(value.layer, ['ut','st','e2e','st/e2e'], `${file}: layer`);
      choice(value.runner, ['node:test','tsx','pytest','unittest','python','contract','node','playwright'], `${file}: runner`);
      if (Boolean(value.directory) === Boolean(value.files)) throw Error(`${file}: choose directory or files discovery`);
      for (const field of ['directory']) if (value[field]) value[field] = pathAt(file,value[field],directory);
      for (const field of ['files','exclude','excludeDirectories']) if (value[field]) {
        strings(value[field],`${file}: ${field}`); value[field] = value[field].map(p => pathAt(file,p,directory));
      }
      if (value.directory && !statSync(join(directory,value.directory)).isDirectory()) throw Error(`${file}: directory must be a directory`);
      if (value.files?.some(p => !statSync(join(directory,p)).isFile())) throw Error(`${file}: files must refer to files`);
      string(value.entryPoint,`${file}: entryPoint`);
      if (value.discovery) choice(value.discovery,['web','source-node','compiled-node'],`${file}: discovery`);
      suites.push({...value,configPath:file});
    }
  }
  return {cases,suites};
}
export function manifestCoverageProblems({cases,suites}, directory = root) {
  const errors = [];
  for (const suite of suites) {
    if (!suite.entryPoint.includes('<')) for (const id of suite.entryPoint.split('/')) {
      if (!cases.some(c => c.id === id)) errors.push(`${suite.configPath}: unknown entryPoint ${id}`);
    }
  }
  for (const suite of suites) for (const file of discover(suite,directory)) {
    if (suite.id === 'suite.browser' || suite.id === 'suite.api' || suite.id.startsWith('suite.adapter.live.')) {
      if (!cases.some(c => c.source === file)) errors.push(`Missing case configuration: ${file}`);
    }
    if (suite.id === 'suite.contract.scenarios') for (const scenario of JSON.parse(readFileSync(join(directory,file),'utf8')).cases) {
      if (!cases.some(c => c.source === file && c.scenarioId === scenario.id)) errors.push(`Missing contract configuration: ${file}#${scenario.id}`);
    }
  }
  return errors;
}
