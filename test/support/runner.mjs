// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, createWriteStream, cpSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, walk } from './discovery.mjs';
import { requireAssertions } from './contract/validation.mjs';
import { subjectEnvironment, modelFacts } from './evaluation.mjs';
import { gateProblems } from './selection.mjs';
export function preflight(c, env = process.env, directory = root) {
  const errors = gateProblems(c, env);
  if (c.runner === 'playwright' && env.CI_E2E_PREPARE_ONLY !== '1' && existsSync(join(directory, '.env'))) {
    errors.push('Browser stack sources .env, which can override executor/ports/data; use an isolated checkout without .env');
  }
  if (c.requirements.includes('build') && !existsSync(join(directory, 'services/api/dist/server.js'))) errors.push('Missing build; run pnpm build');
  if (c.requirements.includes('clean-worktree') && env.CI_E2E_PREPARE_ONLY !== '1') {
    const git = spawnSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8' });
    if (git.status !== 0 || git.stdout.trim()) errors.push('Formal E2E requires a committed candidate and clean tracked worktree');
  }
  if (c.runner === 'contract' && env.E2E_CONTRACT_BASELINE) {
    try {
      const baseline = JSON.parse(readFileSync(env.E2E_CONTRACT_BASELINE, 'utf8'));
      const scenario = JSON.parse(readFileSync(join(directory, c.source), 'utf8')).cases.find(x => x.id === c.scenarioId);
      requireAssertions([scenario], baseline);
    } catch (error) { errors.push(`Invalid contract baseline: ${error.message}`); }
  }
  return errors;
}
export function assessmentReports(evidence) {
  const file = walk(evidence).find(p => p.endsWith('/results.json'));
  if (!file) return [];
  const raw = JSON.parse(readFileSync(join(evidence,file),'utf8'));
  const reports = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      for (const [attempt,result] of (test.results ?? []).entries()) {
        for (const attachment of result.attachments ?? []) if (attachment.name === 'assessment' && attachment.body) {
          reports.push({title:spec.title,attempt,resultStatus:result.status,...JSON.parse(Buffer.from(attachment.body,'base64').toString('utf8'))});
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(raw);
  return reports;
}
export function outputVerdict(c, code, output, evidence) {
  if (c.runner === 'layer') {
    const path = join(evidence, c.resultPath, 'summary.json');
    if (existsSync(path)) {
      try {
        const layer = JSON.parse(readFileSync(path, 'utf8'));
        if (layer.status === 'failed') return { status: 'FAIL', reason: 'Layer workload failed', workloadOutcomes: layer.outcomes };
        if (code === 0 && !layer.outcomes?.length) return { status: 'FAIL', reason: 'Layer executed no workloads' };
      } catch { return { status: 'FAIL', reason: 'Invalid layer summary' }; }
    } else if (code === 0) return { status: 'FAIL', reason: 'Missing layer summary' };
  }
  if (code !== 0) return { status: code === 2 ? 'BLOCKED' : 'FAIL', reason: `Process exited ${code}` };
  if (c.runner === 'playwright') {
    const file = walk(evidence).find(p => p.endsWith('/results.json'));
    if (!file) return { status: 'FAIL', reason: 'Missing Playwright results.json' };
    let raw;
    try { raw = JSON.parse(readFileSync(join(evidence, file), 'utf8')); } catch { return { status: 'FAIL', reason: 'Invalid Playwright results.json' }; }
    const stats = raw.stats ?? {};
    if (stats.unexpected || raw.errors?.length) return { status: 'FAIL', framework: stats };
    if (!stats.expected && !stats.flaky) return { status: stats.skipped ? 'SKIPPED' : 'FAIL', reason: 'No browser cases passed', framework: stats };
    if (c.assertions?.judge) {
      try {
        const reports = assessmentReports(evidence).filter(r => r.resultStatus === 'passed');
        if (reports.length !== (stats.expected ?? 0) + (stats.flaky ?? 0) || reports.some(r => r.mode !== c.assertions.mode || r.status !== 'PASS' || !r.judge?.criteria?.length)) return {status:'FAIL',reason:'Missing successful configured scoring evidence'};
        for (const report of reports) for (const criterion of c.assertions.judge.rubric) {
          const rows = report.judge.criteria.filter(row => row.id === criterion.id);
          if (rows.length !== 1 || !Number.isFinite(rows[0].score) || rows[0].score < criterion.threshold || rows[0].score > 1) return {status:'FAIL',reason:'Judge evidence fails configured threshold'};
        }
      } catch { return {status:'FAIL',reason:'Invalid configured scoring evidence'}; }
    }
    return { status: stats.skipped ? 'SKIPPED' : 'PASS', framework: stats, flaky: (stats.flaky ?? 0) > 0, rawReport: join(evidence, file) };
  }
  if (c.runner === 'node') {
    const summary = output.match(/PASS:\s*(\d+)\/(\d+) steps/);
    const json = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).findLast(v => v && typeof v === 'object' && (v.outcome || 'passed' in v));
    if (!(summary && Number(summary[1]) > 0 && summary[1] === summary[2]) && !(json?.outcome === 'PASS' && json.steps > 0) && !(json?.passed > 0 && json.passed === json.total)) return { status: 'FAIL', reason: 'Missing successful journey step report' };
  }
  if (c.runner === 'pytest' && !/\b[1-9]\d* passed\b/.test(output)) return { status: /\b\d+ skipped\b/.test(output) ? 'SKIPPED' : 'FAIL', reason: 'No pytest cases passed' };
  if (c.runner === 'contract' && !/\b1 cases match the baseline(?:\.| apart from [1-9]\d* accepted difference\(s\):)/.test(output)) return { status: 'FAIL', reason: 'Selected contract assertions did not run' };
  const skipped = [...output.matchAll(/# skipped (\d+)|\b(\d+) skipped\b/g)].reduce((n, m) => n + Number(m[1] ?? m[2]), 0);
  return skipped ? { status: 'SKIPPED', reason: 'Framework reported skipped tests; see raw log', skipped } : { status: 'PASS' };
}
export async function runSelected(selected, { directory = root, env = process.env, failFast = false, resultsRoot } = {}) {
  if (!selected.length) throw new Error('Empty execution selection');
  const runRoot = resolve(directory, resultsRoot ?? join(env.CI_RESULTS_DIR || join(directory, '.test-runs'), `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`));
  mkdirSync(runRoot, { recursive: true });
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).stdout?.trim() || 'unknown';
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8' }).stdout?.trim() !== '';
  const preparation = env.CI_E2E_PREPARE_ONLY === '1';
  if (preparation && selected.some(c => c.runner !== 'playwright')) throw new Error('CI_E2E_PREPARE_ONLY only applies to browser setup');
  const summary = { executionCountKind: 'started entry processes; framework case counts are reported separately', phase: preparation ? 'prepare' : 'test', revision, dirty, selected: selected.map(c => ({ id: c.id, executor: c.requestedExecutor, source: c.source, configPath: c.configPath, llm: c.llm, assertions: c.assertions, profile: c.profile, required: c.required !== false, command: c.command })), outcomes: [] };
  const persist = () => writeFileSync(join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  let stopped = false, interrupted = false, current, interruptionTimer;
  const signal = () => { interrupted = stopped = true; if (current?.pid) { const pid = current.pid; try { process.kill(-pid, 'SIGTERM'); } catch {}
    interruptionTimer ??= setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 5000); } };
  process.on('SIGINT', signal); process.on('SIGTERM', signal);
  try {
    for (const c of selected) {
      const evidence = join(runRoot, `${c.id}-${c.requestedExecutor}`);
      mkdirSync(evidence, { recursive: true });
      const item = { id: c.id, configPath: c.configPath, profile: c.profile, required: c.required !== false, policyReason: c.policyReason, models: modelFacts(c,env), requestedExecutor: c.requestedExecutor, actualExecutor: null, runner: c.runner, evidence, status: 'NOT_RUN', executed: false };
      summary.outcomes.push(item); persist();
      if (stopped) { item.reason = interrupted ? 'Interrupted' : 'Fail-fast'; continue; }
      const problems = preflight(c, env, directory);
      if (problems.length) { Object.assign(item, { status: 'BLOCKED', reason: problems.join('; ') }); }
      else {
        console.log(`RUN ${c.id} [${c.requestedExecutor}]`);
        const log = createWriteStream(join(evidence, 'run.log'));
        let output = '', timedOut = false;
        const started = Date.now();
        const runtime = resolve(directory, env.CI_RUNTIME_DIR || '.test-runs/.runtime', basename(runRoot), `${c.id}-${c.requestedExecutor}`);
        const childEnv = { ...env, ...subjectEnvironment(c,env), ...c.env, CI: '1', TEST_FAIL_FAST: failFast ? '1' : '0', CI_RESULTS_DIR: evidence, CI_RUNTIME_DIR: runtime };
        if (c.runner === 'playwright') Object.assign(childEnv, { CI_E2E_BACKEND: c.requestedExecutor === 'jiuwenswarm' ? 'jiuwenswarm' : 'legacy', SCIENCE_AGENT_EXECUTOR: c.requestedExecutor, SCIENCE_AGENT_ADAPTER: c.requestedExecutor === 'jiuwenswarm' ? '1' : '0' });
        const secrets = Object.entries(env).filter(([key, value]) => (/TOKEN|SECRET|PASSWORD|API_KEY|LLM_KEY/.test(key) || [c.llm?.model?.apiKeyEnv,c.assertions?.judge?.model?.apiKeyEnv].includes(key)) && value?.length > 0).map(([,v]) => v);
        const redact = data => secrets.reduce((s, secret) => s.replaceAll(secret, '[redacted]'), String(data));
        let spawnError;
        const code = await new Promise(resolve => {
          current = spawn(c.command[0], c.command.slice(1), { cwd: directory, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
          const timer = setTimeout(() => { timedOut = true; try { process.kill(-current.pid, 'SIGTERM'); } catch {} }, c.timeoutMs);
          const killTimer = setTimeout(() => { try { process.kill(-current.pid, 'SIGKILL'); } catch {} }, c.timeoutMs + 5000);
          const append = chunk => { const text = redact(chunk); log.write(text); process.stdout.write(text); output = (output + text).slice(-4_000_000); };
          const pending = ['', ''];
          for (const [i, stream] of [current.stdout, current.stderr].entries()) stream.on('data', chunk => {
            pending[i] += chunk;
            const last = pending[i].lastIndexOf('\n');
            if (last >= 0) { append(pending[i].slice(0, last + 1)); pending[i] = pending[i].slice(last + 1); }
          });
          current.once('error', error => { spawnError = error.message; });
          current.once('close', status => { clearTimeout(timer); clearTimeout(killTimer); clearTimeout(interruptionTimer); pending.forEach(append); current = undefined; resolve(status ?? 1); });
        });
        await new Promise(resolve => log.end(resolve));
        rmSync(runtime, { recursive: true, force: true });
        Object.assign(item, { executed: !spawnError, exitCode: code, durationMs: Date.now() - started,
          actualExecutor: spawnError ? null : c.requestedExecutor, ...(preparation && code === 0 ? { status: 'NOT_RUN', prepared: true, reason: 'Dependency preparation only; no tests executed' } : outputVerdict(c, code, output, evidence)) });
        if (c.runner === 'playwright') { try { item.assessments = assessmentReports(evidence); } catch { item.assessmentError = 'Invalid assessment report'; } }
        if (preparation) { item.executed = false; item.actualExecutor = null; }
        if (c.runner === 'contract') { item.actualExecutor = null; item.declaredExecutor = env.E2E_TARGET_EXECUTOR; item.executorEvidence = 'operator-declared external target (E2E_TARGET_EXECUTOR); not independently verified'; }
        if (timedOut || interrupted || spawnError) Object.assign(item, { status: spawnError ? 'BLOCKED' : 'FAIL', reason: spawnError ?? (timedOut ? 'Timeout' : 'Interrupted') });
      }
      console.log(`${item.status} ${c.id}${item.reason ? ': ' + item.reason : ''}`);
      if (failFast && item.required && item.status !== 'PASS') stopped = true;
      persist();
    }
  } finally {
    clearTimeout(interruptionTimer);
    process.off('SIGINT', signal); process.off('SIGTERM', signal);
    summary.counts = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT_RUN'].map(s => [s, summary.outcomes.filter(x => x.status === s).length]));
    summary.executed = summary.outcomes.filter(x => x.executed).length;
    const requiredOutcomes = summary.outcomes.filter(x => x.required);
    summary.observations = summary.outcomes.filter(x => !x.required && x.status !== 'PASS').map(x => ({id:x.id,status:x.status,reason:x.reason}));
    summary.exitCode = requiredOutcomes.every(x => x.status === 'PASS' || (preparation && x.prepared)) ? 0 : requiredOutcomes.some(x => x.status === 'FAIL') ? 1 : 2;
    summary.status = preparation && summary.exitCode === 0 ? 'prepared' : summary.exitCode === 0 ? (summary.observations.length ? 'passed-with-observations' : 'passed') : summary.exitCode === 1 ? 'failed' : 'blocked';
    persist();
    if (env.CI_RESULTS_DIR) {
      const alias = env.CI_RESULT_ALIAS || (selected.length === 1 ? (selected[0].resultPath || 'selection') : 'selection');
      const destination = resolve(directory, env.CI_RESULTS_DIR, alias);
      mkdirSync(destination, { recursive: true });
      for (const item of summary.outcomes) cpSync(item.evidence, join(destination, item.id + '-' + item.requestedExecutor), { recursive: true });
      writeFileSync(join(destination, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    }
  }
  console.log(`Report: ${join(runRoot, 'summary.json')}`);
  return summary;
}
