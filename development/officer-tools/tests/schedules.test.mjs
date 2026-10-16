import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixture,cookie } from './fixture.mjs';

test('real MCP protocol creates public schedules once, reads them back and retains write/consent/permission boundaries',async()=>{
  const f=await fixture();
  const client=new Client({name:'schedule-protocol-e2e',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve(import.meta.dirname,'../server.mjs')],env:{...process.env,...f.env,PORTAL_SESSION_COOKIE:cookie,PORTAL_ENABLE_WRITES:'1'},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  const args={id:'isolated-schedule',title:'Example learning session',startsAt:'2099-02',series:'Example series',modules:'Example module',confirm:true};
  try {
    await client.connect(transport);
    const tools=(await client.listTools()).tools;
    const create=tools.find(tool=>tool.name==='event_schedule_create');
    assert.equal(create.annotations.idempotentHint,true);
    assert.equal(create.annotations.destructiveHint,false);
    assert.equal(create.annotations.readOnlyHint,false);
    const first=await client.callTool({name:'event_schedule_create',arguments:args});
    assert.equal(first.structuredContent.result.created,true);
    const retry=await client.callTool({name:'event_schedule_create',arguments:args});
    assert.equal(retry.structuredContent.result.created,false);
    assert.equal(f.state.writes,1);
    const list=await client.callTool({name:'event_schedule_list',arguments:{}});
    assert.equal(list.structuredContent.result.events.length,1);
    assert.equal(list.structuredContent.result.events[0].startsAt,'2099-02');
    const conflict=await client.callTool({name:'event_schedule_create',arguments:{...args,title:'Different content'}});
    assert.equal(conflict.isError,true);assert.equal(f.state.writes,1);
    for(const change of ['canPublish','aiConsent']) {
      f.state[change]=false;
      const denied=await client.callTool({name:'event_schedule_create',arguments:{...args,id:'other'}});
      assert.equal(denied.isError,true);assert.equal(f.state.writes,1);
      f.state[change]=true;
    }
    const unconfirmed=await client.callTool({name:'event_schedule_create',arguments:{...args,confirm:false}});
    assert.equal(unconfirmed.isError,true);assert.equal(f.state.writes,1);
    assert.ok(!JSON.stringify({first,list}).includes(cookie));
  }finally{await client.close();await f.close();}
});

test('MCP schedule creation stays disabled without explicit write opt-in',async()=>{
  const f=await fixture();
  const client=new Client({name:'schedule-default-deny',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve(import.meta.dirname,'../server.mjs')],env:{...process.env,...f.env,PORTAL_SESSION_COOKIE:cookie,PORTAL_ENABLE_WRITES:'0'},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  try {
    await client.connect(transport);
    const result=await client.callTool({name:'event_schedule_create',arguments:{id:'example',title:'Example session',startsAt:'2099-02',series:'Example series',modules:'Example module',confirm:true}});
    assert.equal(result.isError,true);assert.equal(f.state.writes,0);
  }finally{await client.close();await f.close();}
});
