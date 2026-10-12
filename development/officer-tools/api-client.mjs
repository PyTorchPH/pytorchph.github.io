import { randomUUID } from 'node:crypto';
import { SessionStore,validateCookie } from './session-store.mjs';

const messages={400:'Input validation failed',401:'Login required or session expired',403:'Officer or presidential permission required',404:'Feature is unavailable on this API release',409:'Draft changed; reload its revision before retrying',413:'Input exceeds the API byte limit',429:'Rate limited; retry later',503:'API temporarily unavailable'};

export class PortalError extends Error {
  constructor(status,message=messages[status] ?? 'Portal request failed') {super(message);this.status=status;}
}

export class PortalClient {
  constructor(config,{fetchImpl=fetch,log=event=>process.stderr.write(JSON.stringify(event)+'\n'),store=new SessionStore(config.credentialDirectory,config.apiOrigin)}={}) {
    this.config=config;this.fetch=fetchImpl;this.log=log;this.store=store;
    this.cookie=config.sessionCookie ? validateCookie(config.sessionCookie) : undefined;
    this.externalCookie=Boolean(config.sessionCookie);
  }

  async login(email,password) {
    await this.request('/auth/password',{method:'POST',body:{email,password},authenticate:false,remember:false});
    if(!this.cookie)throw new PortalError(401,'Login did not issue a session');
    try {const identity=await this.identity();await this.store.write(this.cookie);this.externalCookie=false;return {role:identity.role,authenticated:true};}
    catch(error){this.cookie=undefined;throw error;}
  }

  async importSession(cookie) {
    this.cookie=validateCookie(cookie);this.externalCookie=true;
    try {const identity=await this.identity();await this.store.write(this.cookie);this.externalCookie=false;return {role:identity.role,authenticated:true};}
    catch(error){this.cookie=undefined;throw error;}
  }

  async identity() {
    const identity=await this.request('/auth/me',{remember:false});
    if(!['officer','admin'].includes(identity.role))throw new PortalError(403);
    if(!this.externalCookie)await this.store.write(this.cookie);
    return identity;
  }

  async logout() {
    try {await this.request('/auth/signout',{method:'POST'});}
    finally{this.cookie=undefined;await this.store.clear();}
    return {signedOut:true};
  }

  // Mental model: bind credentials to one origin → bounded request → renew cookie → return data; log metadata only.
  async request(path,{method='GET',body,authenticate=true,remember=true}={}) {
    if(!/^\/(auth\/(me|password|signout)|portal\/api\/officer\/[a-z0-9/-]+)$/.test(path))throw new Error('Request path is outside the officer allowlist');
    const encoded=body===undefined ? undefined : JSON.stringify(body);
    if(encoded && Buffer.byteLength(encoded)>128*1024)throw new PortalError(413);
    if(authenticate && !this.cookie && !this.externalCookie)this.cookie=await this.store.read();
    if(authenticate && !this.cookie)throw new PortalError(401);
    const correlationId=randomUUID();const started=Date.now();let status=0;
    try {
      const headers={'Accept':'application/json','Origin':this.config.siteOrigin,'X-Request-ID':correlationId};
      if(authenticate)headers.Cookie=this.cookie;
      if(encoded)headers['Content-Type']='application/json';
      const response=await this.fetch(this.config.apiOrigin+path,{method,headers,body:encoded,redirect:'error',signal:AbortSignal.timeout(15000)});
      status=response.status;
      if(!response.ok) {
        if(status===401 && authenticate){this.cookie=undefined;if(!this.externalCookie)await this.store.clear();}
        throw new PortalError(status);
      }
      const cookie=response.headers.get('set-cookie')?.split(';')[0];
      if(cookie==='ph_session='){this.cookie=undefined;if(!this.externalCookie)await this.store.clear();}
      else if(cookie){this.cookie=validateCookie(cookie);if(remember && !this.externalCookie)await this.store.write(this.cookie);}
      const value=await boundedJson(response);
      return status===202 ? {queued:true,response:value} : value;
    }catch(error){if(error instanceof PortalError)throw error;throw new PortalError(0,'Portal network/response failure; request was not retried');}
    finally{this.log({event:'officer_tools.api.completed',at:new Date().toISOString(),component:'officer_tools',operation:path,method,status,correlationId,durationMs:Date.now()-started});}
  }
}

async function boundedJson(response) {
  if(!response.body)return null;
  const reader=response.body.getReader();const chunks=[];let bytes=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw new Error('Response byte limit exceeded');chunks.push(value);}
    const text=Buffer.concat(chunks).toString('utf8');return text ? JSON.parse(text) : null;
  }finally{await reader.cancel();}
}
