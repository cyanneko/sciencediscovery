// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { loadManifests, manifestCoverageProblems } from './manifests.mjs';
const fixture = () => ({version:1,id:'fixture',owner:'test',layer:'st',surface:'process',runner:'node',source:'scenario.mjs',capabilities:[],llm:{mode:'stub'},assertions:{mode:'deterministic'},supportedExecutors:['native'],timeoutSeconds:1,requirements:[],ci:{pr:{executors:['native'],required:true}},resultPath:'fixture'});
function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),'test-manifests-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'scenario.mjs'),'');
  return {dir, write:(value,name='scenario.case.yaml')=>writeFileSync(join(dir,name),typeof value==='string'?value:stringify(value))};
}
test('YAML rejects unknown fields, duplicate keys and aliases', t => {
  const {dir,write}=setup(t);
  write({...fixture(),typo:true}); assert.throws(()=>loadManifests(dir),/unknown fields/);
  write(stringify(fixture())+'version: 1\n'); assert.throws(()=>loadManifests(dir),/invalid YAML/);
  write('version: 1\nid: &name fixture\nowner: *name\n'); assert.throws(()=>loadManifests(dir),/alias/i);
});
test('policies reject unsupported backends and silent nonblocking or real PR cases',t=>{
  const {dir,write}=setup(t);
  for (const [change,pattern] of [
    [{ci:{pr:{executors:['jiuwenswarm'],required:true}}},/unsupported value/],
    [{ci:{daily:{executors:['native'],required:false}}},/nonblocking policy reason/],
    [{llm:{mode:'real'}},/CI_ALLOW_REAL/],
    [{llm:{mode:'real'},gates:{allowEnv:'CI_ALLOW_REAL',requiredEnv:[]}},/deterministic/],
    [{llm:{mode:'unreviewed'}},/quarantined/],
    [{timeoutSeconds:0},/positive/],
    [{version:2},/version/],
  ]) {write({...fixture(),...change}); assert.throws(()=>loadManifests(dir),pattern);}
});
test('source paths and identities fail closed',t=>{
  const {dir,write}=setup(t);
  write({...fixture(),source:'missing.mjs'}); assert.throws(()=>loadManifests(dir),/missing path/);
  write({...fixture(),source:'../outside.mjs'}); assert.throws(()=>loadManifests(dir),/escapes repository/);
  write(fixture()); write(fixture(),'duplicate.case.yaml'); assert.throws(()=>loadManifests(dir),/duplicate id/);
  write({...fixture(),id:'another'},'duplicate.case.yaml'); assert.throws(()=>loadManifests(dir),/duplicate source ownership/);
});
test('new scenario files require configuration and suite entry points must exist',t=>{
  const {dir,write}=setup(t); write(fixture());
  const suites=[{id:'suite.api',files:['scenario.mjs','new-journey.mjs'],entryPoint:'fixture',configPath:'api.suite.yaml'}];
  writeFileSync(join(dir,'new-journey.mjs'),'');
  assert.match(manifestCoverageProblems({cases:loadManifests(dir).cases,suites},dir).join(),/Missing case configuration: new-journey/);
  suites[0].entryPoint='unknown';
  assert.match(manifestCoverageProblems({cases:[],suites},dir).join(),/unknown entryPoint/);
});
