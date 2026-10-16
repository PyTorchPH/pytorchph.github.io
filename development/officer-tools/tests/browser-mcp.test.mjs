import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PortalClient } from '../api-client.mjs';
import { browserLogin } from '../browser-login.mjs';
import { fixture,cookie } from './fixture.mjs';

test('browser-approved CLI session is reusable by the real stdio MCP without exposing credentials',async()=>{
  const f=await fixture();
  const portal=new PortalClient(f.config,{log:()=>{}});
  const mcp=new Client({name:'browser-officer-e2e',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve(import.meta.dirname,'../server.mjs')],env:{...process.env,...f.env,PORTAL_SESSION_COOKIE:''},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  try {
    let code;
    await browserLogin(portal,{
      notify:message=>{code=message.slice(-8);},
      open:async url=>{
        const requestId=new URL(url).searchParams.get('request');
        const result=await fetch(f.config.apiOrigin+'/auth/cli/approve',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({requestId,userCode:code})});
        assert.equal(result.status,200);
      },
      wait:async()=>{},
    });
    await mcp.connect(transport);
    const identity=await mcp.callTool({name:'identity',arguments:{}});
    assert.equal(identity.structuredContent.result.role,'officer');
    const events=await mcp.callTool({name:'officer_read',arguments:{view:'events'}});
    assert.equal(events.structuredContent.result.count,8);
    assert.ok(!JSON.stringify({identity,events}).includes(cookie));
    assert.ok(!JSON.stringify({identity,events}).includes(code));
  }finally{await mcp.close();await f.close();}
});
