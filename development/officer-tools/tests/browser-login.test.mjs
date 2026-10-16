import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { browserLogin } from '../browser-login.mjs';
import { loginChoice } from '../login-choice.mjs';
import { PortalError } from '../api-client.mjs';

function clientFixture({pending=0,expire=false,deny=false}={}) {
  const calls=[];let challenge,attempts=0,stored=0;
  const client={config:{siteOrigin:'https://pytorch.ph'},store:{async write(){stored++;}},
    async identity(){if(deny)throw new PortalError(403);return {role:'officer'};},
    async request(path,options) {
      calls.push({path,...options});
      if(path.endsWith('/start')) {challenge=options.body.challenge;return {requestId:'11111111-1111-4111-8111-111111111111',userCode:'ABCDEF12',interval:5,expiresIn:300};}
      assert.equal(createHash('sha256').update(options.body.verifier).digest('base64url'),challenge);
      if(expire)throw new PortalError(410);
      if(attempts++<pending)throw new PortalError(428);
      this.cookie='ph_session='+'a'.repeat(64);return {role:'officer'};
    }};
  return {client,calls,get stored(){return stored;}};
}

test('chooser supports email and Google without reading secrets or falling back silently',async()=>{
  assert.deepEqual(await loginChoice('google'),{method:'google',email:undefined});
  assert.deepEqual(await loginChoice(undefined,'officer@example.test'),{method:'email',email:'officer@example.test'});
  await assert.rejects(loginChoice('other'),/method/);
});

test('browser login uses trusted URL, PKCE, bounded polling and private origin-bound session storage',async()=>{
  const fixture=clientFixture({pending:1});const urls=[],messages=[];let clock=0;
  const result=await browserLogin(fixture.client,{open:async url=>urls.push(url),notify:message=>messages.push(message),wait:async ms=>{clock+=ms;},now:()=>clock});
  assert.deepEqual(result,{authenticated:true,role:'officer',method:'google'});
  assert.equal(fixture.stored,1);
  assert.match(urls[0],/^https:\/\/pytorch\.ph\/portal\/cli-login\//);
  assert.equal(new URL(urls[0]).searchParams.has('verifier'),false);
  assert.equal(messages.length,1);
  assert.ok(fixture.calls.every(call=>call.authenticate===false && call.remember===false));
  const verifier=fixture.calls[1].body.verifier;
  assert.ok(!JSON.stringify({urls,messages,result}).includes(verifier));
  assert.ok(!JSON.stringify(result).includes('ph_session'));
});

test('expired, denied and timed-out flows never store a usable session',async()=>{
  for(const options of [{expire:true},{deny:true}]) {
    const fixture=clientFixture(options);
    await assert.rejects(browserLogin(fixture.client,{open:async()=>{},notify:()=>{},wait:async()=>{}}));
    assert.equal(fixture.stored,0);assert.equal(fixture.client.cookie,undefined);
  }
  const fixture=clientFixture({pending:100});let clock=0;
  await assert.rejects(browserLogin(fixture.client,{open:async()=>{},notify:()=>{},wait:async ms=>{clock+=ms;},now:()=>clock}),error=>error.status===410);
  assert.equal(fixture.calls.length,61);assert.equal(fixture.stored,0);
});
