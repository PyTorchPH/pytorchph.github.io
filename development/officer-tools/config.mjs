import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function configuration(env=process.env) {
  const apiOrigin=trustedOrigin(env.PORTAL_API_ORIGIN ?? 'https://api.pytorch.ph',env.PORTAL_ALLOW_LOCALHOST==='1');
  const siteOrigin=trustedOrigin(env.PORTAL_SITE_ORIGIN ?? 'https://pytorch.ph',env.PORTAL_ALLOW_LOCALHOST==='1');
  return {apiOrigin,siteOrigin,enableWrites:env.PORTAL_ENABLE_WRITES==='1',sessionCookie:env.PORTAL_SESSION_COOKIE,credentialDirectory:resolve(env.PORTAL_CONFIG_HOME ?? homedir(),'.pytorch-ph/officer-tools')};
}

export function trustedOrigin(value,allowLocalhost=false) {
  const url=new URL(value);
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username || url.password || url.pathname!=='/' || url.search || url.hash || (url.protocol!=='https:' && !(allowLocalhost && loopback && url.protocol==='http:')))throw new Error('API/site origin must be an HTTPS origin; explicit loopback HTTP is available for local tests');
  return url.origin;
}
