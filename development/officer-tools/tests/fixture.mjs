import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { once } from 'node:events';
import { configuration } from '../config.mjs';

export const cookie='ph_session='+'a'.repeat(64);
export const password='isolated-test-password';

export async function fixture() {
  const directory=await mkdtemp(join(tmpdir(),'pytorch-officer-tools-'));
  const state={role:'officer',expired:false,writes:0,canApprove:false,revision:1,approvals:0,redirect:false,large:false,aiConsent:true,projection:null,cliFlow:null,schedules:[],canPublish:true};
  const server=createServer(async(request,response)=>{
    const send=(status,data)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(data));};
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const body=chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if(request.url==='/public/ai-projection/verify'){
      if(!state.aiConsent || state.expired || !['officer','admin'].includes(state.role))return send(403,{error:'Projection revoked'});
      if(body.id!=='11111111-1111-4111-8111-111111111111' || body.proof!=='b'.repeat(64))return send(400,{error:'Invalid capability'});
      return send(200,{projection:state.projection});
    }
    if(request.url==='/auth/cli/start'){
      state.cliFlow={challenge:body.challenge,approved:false,consumed:false};
      return send(200,{requestId:'22222222-2222-4222-8222-222222222222',userCode:'ABCDEF12',interval:5,expiresIn:300});
    }
    if(request.url==='/auth/cli/poll'){
      const flow=state.cliFlow;
      if(!flow || flow.consumed)return send(410,{error:'Consumed'});
      if(body.requestId!=='22222222-2222-4222-8222-222222222222' || createHash('sha256').update(body.verifier).digest('base64url')!==flow.challenge)return send(403,{error:'PKCE mismatch'});
      if(!flow.approved)return send(428,{error:'Pending'});
      if(!['officer','admin'].includes(state.role))return send(403,{error:'Officer required'});
      flow.consumed=true;response.setHeader('set-cookie',cookie+'; HttpOnly; Secure; SameSite=Lax; Path=/');return send(200,{role:state.role});
    }
    if(request.url==='/auth/password'){
      if(body.email!=='officer@example.invalid' || body.password!==password)return send(401,{error:'Invalid credentials'});
      response.setHeader('set-cookie',cookie+'; HttpOnly; Secure; SameSite=Lax; Path=/');return send(200,{role:state.role});
    }
    if(request.headers.cookie!==cookie || state.expired)return send(401,{error:'Expired'});
    if(request.url==='/auth/me')return send(200,{id:'isolated-officer',display_name:'Test officer',role:state.role});
    if(request.url==='/auth/signout'){response.setHeader('set-cookie','ph_session=; HttpOnly; Secure; Max-Age=0; Path=/');return send(200,{signedOut:true});}
    if(!['officer','admin'].includes(state.role))return send(403,{error:'Officer required'});
    if(request.url==='/auth/cli/approve'){
      if(body.requestId!=='22222222-2222-4222-8222-222222222222' || body.userCode!=='ABCDEF12' || !state.cliFlow)return send(403,{error:'Code mismatch'});
      state.cliFlow.approved=true;return send(200,{approved:true});
    }
    if(request.url==='/portal/api/officer/ai-projection'){
      if(!state.aiConsent)return send(403,{error:'AI consent required'});
      state.projection=body.view.startsWith('event_schedules/') ? {view:'event_schedules',events:state.schedules,nextCursor:null} : body.view==='identity' ? {role:'officer',subjectAlias:'p_k1_opaque-actor'} : {view:body.view,count:8};
      return send(200,{projection:state.projection,ticket:{id:'11111111-1111-4111-8111-111111111111',proof:'b'.repeat(64)}});
    }
    if(request.url==='/portal/api/officer/event-schedules'){
      if(!state.aiConsent || !state.canPublish)return send(403,{error:'Consent and publication grant required'});
      const {confirm,...event}=body;if(confirm!==true)return send(400,{error:'Confirmation required'});
      const existing=state.schedules.find(row=>row.id===event.id);
      if(existing && JSON.stringify(existing)!==JSON.stringify(event))return send(409,{error:'Different content'});
      if(!existing){state.schedules.push(event);state.writes++;}
      return send(200,{created:!existing,event:existing ?? event});
    }
    if(request.method==='GET'){
      if(request.url==='/portal/api/officer/site-content')return send(200,{revision:state.revision,document:{branding:{tagline:'Fixture'}},approvals:state.approvals,requiredApprovals:2,canApprove:state.canApprove});
      if(request.url==='/portal/api/officer/events'){
        if(state.redirect){response.writeHead(302,{Location:'https://example.invalid/credential-collector'});return response.end();}
        if(state.large)return send(200,{large:'x'.repeat(2*1024*1024)});
        return send(200,[{id:'event-1',title:'A real fixture event'}]);
      }
      return send(200,{view:request.url});
    }
    state.writes++;
    if(body.revision!==state.revision)return send(409,{error:'Stale'});
    if(request.url.endsWith('/approve')){
      if(!state.canApprove)return send(403,{error:'Current president required'});
      state.approvals=1;return send(200,{revision:state.revision,approvals:1,requiredApprovals:2,publishedRevision:0});
    }
    if(!body.document?.branding)return send(400,{error:'Website document required'});
    state.revision++;return send(200,{revision:state.revision,document:body.document,approvals:0});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const env={PORTAL_API_ORIGIN:origin,PORTAL_SITE_ORIGIN:origin,PORTAL_ALLOW_LOCALHOST:'1',PORTAL_CONFIG_HOME:directory};
  return {directory,state,env,config:configuration(env),async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!resolve(directory).startsWith(resolve(tmpdir())+sep+'pytorch-officer-tools-'))throw new Error('Fixture cleanup escaped its dedicated temporary directory');await rm(directory,{recursive:true,force:true});}};
}
