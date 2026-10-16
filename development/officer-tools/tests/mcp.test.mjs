import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { cookie,fixture } from './fixture.mjs';

const root=resolve(import.meta.dirname,'..');

test('official SDK stdio client discovers tools, matches CLI results and surfaces permission/validation failures',async()=>{
  const f=await fixture();const env={...process.env,...f.env,PORTAL_SESSION_COOKIE:cookie};
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve(root,'server.mjs')],env,stderr:'pipe'});
  const client=new Client({name:'isolated-officer-integration',version:'0.1.0'});let logs='';
  try {
    await client.connect(transport);transport.stderr?.on('data',chunk=>logs+=chunk);
    const tools=await client.listTools();assert.deepEqual(tools.tools.map(tool=>tool.name).sort(),['event_schedule_create','event_schedule_list','identity','officer_read','website_approve','website_get_draft','website_save_draft']);
    const identity=await client.callTool({name:'identity',arguments:{}});assert.equal(identity.structuredContent.result.role,'officer');
    const cli=await runCli(['identity'],env);assert.equal(cli.status,0);assert.deepEqual(JSON.parse(cli.output),identity.structuredContent.result);
    assert.equal(identity.structuredContent.result.id,undefined);assert.equal(identity.structuredContent.result.display_name,undefined);
    const events=await client.callTool({name:'officer_read',arguments:{view:'events'}});assert.deepEqual(events.structuredContent.result,{view:'events',count:8});assert.ok(!JSON.stringify(events).includes('event-1'));
    const disabled=await client.callTool({name:'website_approve',arguments:{revision:1,confirm:true}});assert.equal(disabled.isError,true);assert.equal(f.state.writes,0);
    f.state.role='member';const forbidden=await client.callTool({name:'website_get_draft',arguments:{}});assert.equal(forbidden.isError,true);
    f.state.role='officer';f.state.expired=true;const expired=await client.callTool({name:'identity',arguments:{}});assert.equal(expired.isError,true);
    assert.match(logs,/officer_tools.command.failed/);assert.ok(!logs.includes(cookie));assert.ok(!cli.errors.includes(cookie));
  }finally{await client.close();await f.close();}
});

test('CLI JSON draft save and approval use the same write guards and server outcomes',async()=>{
  const f=await fixture();const env={...process.env,...f.env,PORTAL_SESSION_COOKIE:cookie};
  try {
    const disabled=await runCli(['website-approve','--revision','1','--confirm'],env);assert.equal(disabled.status,1);assert.equal(f.state.writes,0);
    const notPresident=await runCli(['website-approve','--revision','1','--confirm','--write','--human-raw'],env);assert.equal(notPresident.status,1);assert.match(notPresident.errors,/permission required/);
    const draft=await runCli(['website-draft','--human-raw'],env);assert.equal(draft.status,0);
    const file=resolve(f.directory,'draft.json');await writeFile(file,draft.output);
    const saved=await runCli(['website-save','--file',file,'--write','--human-raw'],env);assert.equal(saved.status,0);assert.equal(JSON.parse(saved.output).revision,2);
    f.state.canApprove=true;const approved=await runCli(['website-approve','--revision','2','--confirm','--write','--human-raw'],env);assert.equal(approved.status,0);assert.equal(JSON.parse(approved.output).approvals,1);
  }finally{await f.close();}
});

async function runCli(args,env) {
  const child=spawn(process.execPath,[resolve(root,'cli.mjs'),...args],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',errors='';
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return {status,output,errors};
}
