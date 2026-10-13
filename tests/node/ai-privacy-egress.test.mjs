import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvedRequest } from '../../extension/dist/ai-privacy.js';
import { aiComplete } from '../../extension/dist/local-ai.js';

const ticket={id:'11111111-1111-4111-8111-111111111111',proof:'b'.repeat(64)};

test('raw prompts, mixed tickets and caller-chosen origins fail before network/key access',async()=>{
  const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected egress');};
  try {
    for(const request of [{prompt:'Jane Doe jane@example.test'}, {ticket,prompt:'secret'}, {ticket,apiOrigin:'https://example.invalid'}])await assert.rejects(approvedRequest(request));
    assert.equal(calls,0);
    const probe=await approvedRequest({prompt:'Reply with the single word READY.',maxTokens:10});assert.equal(probe.maxTokens,10);assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});

test('real extension provider call uses only the backend prompt; verifier never receives provider key',async()=>{
  const oldFetch=globalThis.fetch;const oldChrome=globalThis.chrome;const requests=[];
  globalThis.chrome={storage:{local:{get:async()=>({pytorchPhLocalAI:{provider:'openai',model:'test-model',apiKey:'synthetic-key-only',baseUrl:'https://api.openai.com/v1',apiVersion:'',project:'',region:''}})}},permissions:{contains:async()=>true}};
  globalThis.fetch=async(url,options)=>{
    requests.push({url:String(url),options});
    if(String(url)==='https://api.pytorch.ph/public/ai-projection/verify')return Response.json({system:'Use filtered data only',prompt:'{"subjectAlias":"p_k1_alias","skills":["engineering"]}',maxTokens:1200,json:true,projection:{extra:'Never forward this extra object'}});
    return Response.json({choices:[{message:{content:'{"summary":"Learn SQL"}'}}]});
  };
  try {
    assert.equal(await aiComplete({ticket}),'{'+'"summary":"Learn SQL"}');assert.equal(requests.length,2);
    const verification=requests[0];assert.equal(verification.options.redirect,'error');assert.equal(verification.options.credentials,'omit');assert.ok(!JSON.stringify(verification).includes('synthetic-key-only'));
    const model=JSON.stringify(requests[1].options.body);assert.ok(model.includes('p_k1_alias'));assert.ok(!model.includes('extra object'));assert.ok(!model.includes(ticket.proof));
  }finally{globalThis.fetch=oldFetch;globalThis.chrome=oldChrome;}
});

test('revoked capability and UTF-8 byte overflow never reach a model',async()=>{
  const oldFetch=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return new Response('{}',{status:403});};await assert.rejects(approvedRequest({ticket}));assert.equal(calls,1);
    globalThis.fetch=async()=>Response.json({prompt:'字'.repeat(60000),system:'Safe',maxTokens:1200,json:true});await assert.rejects(approvedRequest({ticket}),/byte limit/);
  }finally{globalThis.fetch=oldFetch;}
});
