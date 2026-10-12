import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile,stat } from 'node:fs/promises';
import { PortalClient } from '../api-client.mjs';
import { commandCatalog,executeCommand } from '../commands.mjs';
import { configuration } from '../config.mjs';
import { validateCookie } from '../session-store.mjs';
import { cookie,password,fixture } from './fixture.mjs';

test('configuration rejects credential-bearing origins, remote HTTP and cookie/header injection',()=>{
  for(const origin of ['http://example.org','https://user:secret@example.org','https://example.org/a','https://example.org/?token=secret'])assert.throws(()=>configuration({PORTAL_API_ORIGIN:origin}));
  assert.throws(()=>configuration({PORTAL_API_ORIGIN:'http://127.0.0.1'}));
  assert.throws(()=>validateCookie(cookie+'\r\nX-Evil: 1'));
  assert.throws(()=>validateCookie('ph_session=bad'));
});

test('CLI-account login stores only origin-bound session with private permissions; logs omit secrets',async()=>{
  const f=await fixture();const events=[];const client=new PortalClient(f.config,{log:event=>events.push(event)});
  try {
    assert.deepEqual(await client.login('officer@example.invalid',password),{role:'officer',authenticated:true});
    const stored=JSON.parse(await readFile(client.store.file,'utf8'));assert.equal(stored.apiOrigin,f.config.apiOrigin);assert.equal(stored.cookie,cookie);assert.equal(stored.password,undefined);
    if(process.platform!=='win32')assert.equal((await stat(client.store.file)).mode & 0o777,0o600);
    const resumed=new PortalClient(f.config,{log:()=>{}});assert.equal((await resumed.identity()).role,'officer');
    await client.logout();assert.equal(await client.store.read(),undefined);
    const logs=JSON.stringify(events);assert.ok(!logs.includes(cookie));assert.ok(!logs.includes(password));assert.ok(!logs.includes('officer@example.invalid'));assert.ok(events.every(event=>event.correlationId && typeof event.durationMs==='number'));
  }finally{await f.close();}
});

test('server role and expired-session responses stay authoritative; member login does not persist credentials',async()=>{
  const f=await fixture();const client=new PortalClient(f.config,{log:()=>{}});
  try {
    f.state.role='member';await assert.rejects(client.login('officer@example.invalid',password),error=>error.status===403);assert.equal(await client.store.read(),undefined);
    f.state.role='officer';await client.importSession(cookie);f.state.expired=true;
    await assert.rejects(client.identity(),error=>error.status===401);assert.equal(await client.store.read(),undefined);
  }finally{await f.close();}
});

test('writes require opt-in, exact revision and confirmation; API rejects non-presidents and stale drafts',async()=>{
  const f=await fixture();const client=new PortalClient({...f.config,sessionCookie:cookie},{log:()=>{}});const commands=commandCatalog(client);
  try {
    const input={revision:1,document:{branding:{tagline:'Updated'}}};
    await assert.rejects(executeCommand(commands,'website_save_draft',input),error=>error.status===403);assert.equal(f.state.writes,0);
    client.config.enableWrites=true;
    assert.equal((await executeCommand(commands,'website_save_draft',input)).revision,2);
    await assert.rejects(executeCommand(commands,'website_save_draft',input),error=>error.status===409);
    await assert.rejects(executeCommand(commands,'website_approve',{revision:2,confirm:false}));
    await assert.rejects(executeCommand(commands,'website_approve',{revision:2,confirm:true}),error=>error.status===403);
    f.state.canApprove=true;
    const result=await executeCommand(commands,'website_approve',{revision:2,confirm:true});assert.equal(result.approvals,1);assert.equal(result.requiredApprovals,2);assert.equal(result.publishedRevision,0);
    await assert.rejects(executeCommand(commands,'officer_read',{view:'../../auth/password'}));
    await assert.rejects(executeCommand(commands,'website_save_draft',{revision:2,document:{branding:{tagline:'x'.repeat(128*1024)}}}),error=>error.status===413);
  }finally{await f.close();}
});

test('redirects never forward credentials and oversized responses fail instead of being returned',async()=>{
  const f=await fixture();const client=new PortalClient({...f.config,sessionCookie:cookie},{log:()=>{}});
  try {
    f.state.redirect=true;await assert.rejects(client.request('/portal/api/officer/events'),error=>error.status===0);
    f.state.redirect=false;f.state.large=true;await assert.rejects(client.request('/portal/api/officer/events'),error=>error.status===0);
  }finally{await f.close();}
});
