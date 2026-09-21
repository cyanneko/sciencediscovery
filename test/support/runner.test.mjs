// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSelected, outputVerdict, preflight } from './runner.mjs';
const task = (id, code) => ({ id, command: [process.execPath, '-e', `process.exit(${code})`], runner: 'fixture', requestedExecutor: 'independent', executors: [], requirements: [], timeoutMs: 1000 });
test('independent failures continue; fail-fast leaves explicit NOT_RUN evidence', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'test-runner-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const selected = [task('fail', 1), task('pass', 0)];
  const result = await runSelected(selected, { resultsRoot: join(dir, 'full'), env: {} });
  assert.deepEqual(result.outcomes.map(c => c.status), ['FAIL', 'PASS']); assert.equal(result.exitCode, 1);
  const fast = await runSelected(selected, { resultsRoot: join(dir, 'fast'), env: {}, failFast: true });
  assert.deepEqual(fast.outcomes.map(c => c.status), ['FAIL', 'NOT_RUN']);
  const blocked = await runSelected([{ ...task('gated', 0), gates: { allowEnv: 'ALLOW_FIXTURE' } }], { resultsRoot: join(dir, 'blocked'), env: {} });
  assert.equal(blocked.executed, 0); assert.equal(blocked.outcomes[0].actualExecutor, null); assert.equal(blocked.exitCode, 2);
});
test('zero exit cannot hide absent assertions or skipped browser/pytest cases', t => {
  const dir = mkdtempSync(join(tmpdir(), 'test-verdict-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(outputVerdict({ runner: 'contract' }, 0, '', dir).status, 'FAIL');
  assert.equal(outputVerdict({ runner: 'node' }, 0, 'PASS: 0/0 steps', dir).status, 'FAIL');
  assert.equal(outputVerdict({ runner: 'pytest' }, 0, '8 skipped', dir).status, 'SKIPPED');
  assert.equal(outputVerdict({ runner: 'playwright' }, 0, '', dir).status, 'FAIL');
  mkdirSync(join(dir, 'test-results')); writeFileSync(join(dir, 'test-results/results.json'), JSON.stringify({ stats: { expected: 0, skipped: 4 } }));
  assert.equal(outputVerdict({ runner: 'playwright' }, 0, '', dir).status, 'SKIPPED');
});
test('CI compatibility publishes its summary and preparation is not counted as execution', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'test-ci-report-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prepared = await runSelected([{ ...task('browser', 0), runner: 'playwright' }], {
    env: { CI_E2E_PREPARE_ONLY: '1', CI_RESULTS_DIR: dir, CI_RESULT_ALIAS: 'e2e' },
  });
  assert.equal(prepared.phase, 'prepare'); assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.executed, 0); assert.equal(prepared.exitCode, 0);
  assert.equal(prepared.outcomes[0].status, 'NOT_RUN');
  assert.equal(JSON.parse(readFileSync(join(dir, 'e2e/summary.json'))).phase, 'prepare');
});
test('a missing executable is BLOCKED and timeout fails without hiding later work', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'test-timeout-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = await runSelected([
    { ...task('missing', 0), command: ['/missing-test-executable'] },
    { ...task('timeout', 0), timeoutMs: 100, command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'] },
    task('after', 0),
  ], { resultsRoot: dir, env: {} });
  assert.deepEqual(result.outcomes.map(c => c.status), ['BLOCKED', 'FAIL', 'PASS']);
  assert.equal(result.outcomes[1].reason, 'Timeout');
});
test('a checkout .env cannot silently override the selected browser executor', t => {
  const dir = mkdtempSync(join(tmpdir(), 'test-executor-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.env'), 'SCIENCE_AGENT_EXECUTOR=native\n');
  const c = { ...task('browser', 0), runner: 'playwright', requestedExecutor: 'jiuwenswarm', executors: ['jiuwenswarm'] };
  assert.match(preflight(c, {}, dir).join('\n'), /override executor/);
});

test('observational failures stay visible and do not stop required work', async t => {
  const dir=mkdtempSync(join(tmpdir(),'test-observations-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const result=await runSelected([
    {...task('observe-failure',1),required:false,policyReason:'Target coverage under review'},
    {...task('observe-blocked',0),required:false,gates:{allowEnv:'ALLOW_FIXTURE'}},
    task('required-pass',0),
  ],{resultsRoot:dir,env:{},failFast:true});
  assert.deepEqual(result.outcomes.map(c=>c.status),['FAIL','BLOCKED','PASS']);
  assert.equal(result.exitCode,0); assert.equal(result.status,'passed-with-observations');
  assert.equal(result.observations.length,2);
  assert.equal(result.outcomes[0].policyReason,'Target coverage under review');
});

test('contract verdict retains upstream accepted-difference semantics', t => {
  const dir=mkdtempSync(join(tmpdir(),'test-contract-verdict-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  assert.equal(outputVerdict({runner:'contract'},0,'1 cases match the baseline apart from 2 accepted difference(s):',dir).status,'PASS');
  assert.equal(outputVerdict({runner:'contract'},1,'1 cases match the baseline.',dir).status,'FAIL');
});
test('browser children receive the selected backend consistently despite inherited overrides', async t => {
  const dir=mkdtempSync(join(tmpdir(),'test-backend-env-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const executor of ['native','jiuwenswarm']) {
    const output=join(dir,executor+'.json');
    await runSelected([{
      ...task('browser-'+executor,0),runner:'playwright',requestedExecutor:executor,executors:['native','jiuwenswarm'],
      command:[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify([process.env.CI_E2E_BACKEND,process.env.SCIENCE_AGENT_EXECUTOR,process.env.SCIENCE_AGENT_ADAPTER]))`],
    }],{resultsRoot:join(dir,executor),env:{CI_E2E_BACKEND:'wrong-inherited-value',JIUWENSWARM_GATEWAY_URL:'http://localhost',JIUWENSWARM_MGMT_URL:'http://localhost'}});
    assert.deepEqual(JSON.parse(readFileSync(output)),[executor==='native'?'legacy':executor,executor,executor==='native'?'0':'1']);
  }
});

test('a framework pass cannot conceal missing or below-threshold judge evidence', t => {
  const dir=mkdtempSync(join(tmpdir(),'test-judge-verdict-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'test-results'));
  const c={runner:'playwright',assertions:{mode:'hybrid',judge:{rubric:[{id:'correctness',threshold:0.8}]}}};
  const write=assessment=>writeFileSync(join(dir,'test-results/results.json'),JSON.stringify({stats:{expected:1},suites:[{specs:[{title:'case',tests:[{results:[{status:'passed',attachments:assessment?[{name:'assessment',body:Buffer.from(JSON.stringify(assessment)).toString('base64')}]:[]}]}]}]}]}));
  write();assert.equal(outputVerdict(c,0,'',dir).status,'FAIL');
  write({mode:'hybrid',status:'PASS',judge:{criteria:[{id:'correctness',score:0.2}]}});assert.equal(outputVerdict(c,0,'',dir).status,'FAIL');
  write({mode:'hybrid',status:'PASS',judge:{criteria:[{id:'correctness',score:0.9}]}});assert.equal(outputVerdict(c,0,'',dir).status,'PASS');
  assert.equal(outputVerdict(c,1,'',dir).status,'FAIL');
});
