// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { validateAssertions, resolveModel, evaluationProblems, subjectEnvironment, evaluateEvidence } from './evaluation.mjs';
const model = {protocol:'chat-completions',baseUrlEnv:'SUBJECT_URL',apiKeyEnv:'SUBJECT_KEY',modelEnv:'SUBJECT_MODEL'};
const judgeModel = {protocol:'chat-completions',baseUrlEnv:'JUDGE_URL',apiKeyEnv:'JUDGE_KEY',model:'judge-version'};
const policy = () => ({mode:'hybrid',judge:{model:judgeModel,timeoutSeconds:1,maxTokens:100,maxInputCharacters:5000,rubric:[{id:'correctness',description:'The answer meets the task.',threshold:0.8}]}});
const env = {CI_ALLOW_REAL:'1',SUBJECT_URL:'http://localhost/subject/v1',SUBJECT_KEY:'subject-secret',SUBJECT_MODEL:'subject-version',JUDGE_URL:'http://localhost/judge/v1',JUDGE_KEY:'judge-secret'};
const input = {task:'Compute 2+2',answer:'4'};
const response = (score=0.9) => ({choices:[{message:{content:JSON.stringify({criteria:[{id:'correctness',score,reason:'matches evidence'}]})}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
test('subject and judge models resolve separately; credentials and model selection are configuration driven',()=>{
  assert.equal(resolveModel(model,env).model,'subject-version');
  assert.equal(resolveModel(judgeModel,env).model,'judge-version');
  assert.equal(subjectEnvironment({runner:'playwright',llm:{model}},env).E2E_LLM_TOKEN,'subject-secret');
  assert.equal(subjectEnvironment({runner:'pytest',llm:{model}},env).REAL_LLM_KEY,'subject-secret');
  assert.ok(evaluationProblems({llm:{model},assertions:policy()},{}).length>=3);
  assert.throws(()=>resolveModel({...model,model:'also-literal'},env),/exactly one/);
  assert.throws(()=>resolveModel(model,{...env,SUBJECT_URL:'http://secret@localhost/v1'}),/without credentials/);
});
test('schema rejects typos, missing criteria, duplicate IDs and invalid thresholds',()=>{
  for(const change of [{rubric:[]},{maxTokens:0},{rubric:[{id:'correctness',description:'x',threshold:1.1}]},{rubric:[...policy().judge.rubric,...policy().judge.rubric]}]) assert.throws(()=>validateAssertions({...policy(),judge:{...policy().judge,...change}}));
  assert.throws(()=>validateAssertions({mode:'deterministic',judge:policy().judge}));
  assert.throws(()=>validateAssertions({...policy(),typo:true}));
});
test('judge sends bounded evidence to a real HTTP endpoint and persists structured scores without credentials',async t=>{
  let request;
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;request={url:req.url,key:req.headers.authorization,body:JSON.parse(body)};res.setHeader('content-type','application/json');res.end(JSON.stringify(response()));});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const result=await evaluateEvidence(policy(),{...input,context:'judge-secret and subject-secret'},{env:{...env,JUDGE_URL:`http://127.0.0.1:${server.address().port}/v1`}});
  assert.equal(result.status,'PASS');assert.equal(result.judge.criteria[0].threshold,0.8);assert.equal(result.judge.usage.total_tokens,15);
  assert.equal(request.url,'/v1/chat/completions');assert.equal(request.key,'Bearer judge-secret');assert.equal(request.body.model,'judge-version');
  assert.ok(!request.body.messages[1].content.includes('judge-secret'));assert.ok(!JSON.stringify(result).includes('secret'));
});
test('low scores fail; malformed, duplicate, missing and nonfinite scores cannot pass',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>response(0.2)});
  assert.equal((await evaluateEvidence(policy(),input,{env,fetchImpl})).status,'FAIL');
  for(const content of ['not JSON','{}',JSON.stringify({criteria:[]}),JSON.stringify({criteria:[{id:'wrong',score:1,reason:'x'}]}),JSON.stringify({criteria:[{id:'correctness',score:'1',reason:'x'}]})]) {
    await assert.rejects(()=>evaluateEvidence(policy(),input,{env,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content}}]})})}),/invalid scoring response/);
  }
});
test('opt-in, evidence limits, HTTP errors and timeouts fail closed; deterministic mode makes no call',async()=>{
  const forbidden=async()=>{throw Error('must not call')};
  assert.equal((await evaluateEvidence({mode:'deterministic'},undefined,{env:{},fetchImpl:forbidden})).status,'PASS');
  await assert.rejects(()=>evaluateEvidence(policy(),input,{env:{...env,CI_ALLOW_REAL:'0'},fetchImpl:forbidden}),/Opt-in/);
  await assert.rejects(()=>evaluateEvidence(policy(),null,{env,fetchImpl:forbidden}),/evidence/);
  await assert.rejects(()=>evaluateEvidence(policy(),{...input,answer:'x'.repeat(6000)},{env,fetchImpl:forbidden}),/maxInputCharacters/);
  await assert.rejects(()=>evaluateEvidence(policy(),input,{env,fetchImpl:async()=>({ok:false,status:429})}),/HTTP 429/);
  await assert.rejects(()=>evaluateEvidence(policy(),input,{env,fetchImpl:async()=>{throw new DOMException('secret','TimeoutError')}}),/timed out/);
});
