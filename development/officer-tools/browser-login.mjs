import { createHash,randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { PortalError } from './api-client.mjs';

const execute=promisify(execFile);

// Mental model: create PKCE proof → open trusted portal → wait for explicit browser approval → store origin-bound session.
export async function browserLogin(client,{open=openBrowser,wait=delay,notify=message=>process.stderr.write(message+'\n'),now=Date.now}={}) {
  const verifier=randomBytes(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const started=now();
  const request=await client.request('/auth/cli/start',{method:'POST',body:{challenge},authenticate:false,remember:false});
  if(!/^[0-9a-f-]{36}$/.test(request.requestId) || !/^[A-F0-9]{8}$/.test(request.userCode) || request.interval!==5 || request.expiresIn!==300)throw new Error('Invalid browser-login response');
  const url=new URL('/portal/cli-login/',client.config.siteOrigin);
  url.searchParams.set('request',request.requestId);
  notify('Bubukas ang browser. Ilagay ang code na ito at aprubahan lang kung ikaw ang nag-login: '+request.userCode);
  await open(url.href);
  while(now()-started<300000) {
    await wait(5000);
    try {
      await client.request('/auth/cli/poll',{method:'POST',body:{requestId:request.requestId,verifier},authenticate:false,remember:false});
      if(!client.cookie)throw new PortalError(401);
      const identity=await client.identity();
      await client.store.write(client.cookie);
      client.externalCookie=false;
      return {authenticated:true,role:identity.role,method:'google'};
    }catch(error) {
      if(error instanceof PortalError && [428,429].includes(error.status))continue;
      client.cookie=undefined;
      throw error;
    }
  }
  throw new PortalError(410,'Nag-expire ang browser login; subukan muli.');
}

async function openBrowser(url) {
  if(process.platform==='win32')await execute('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true});
  else if(process.platform==='darwin')await execute('open',[url]);
  else await execute('xdg-open',[url]);
}
