import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { mockApi } from '../../development/pages-demo/verify/mock-api.mjs';
import { servePages } from '../../development/pages-demo/verify/serve-pages.mjs';
import { PORTAL_BASE_PATH } from '../../development/pages-demo/portal-base-path.mjs';

const root=resolve(import.meta.dirname,'../..');
const site=await servePages({portalOut:resolve(root,'frontend/portal-static/out'),siteOut:resolve(root,'frontend/public-site/_site')});
let browser;
try {
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=await chromium.launch({headless:true,executablePath:process.env.PH_DEMO_BROWSER || (existsSync(chrome)?chrome:undefined)});
  const context=await browser.newContext();
  await context.addInitScript(()=>{const read=Storage.prototype.getItem;Storage.prototype.getItem=function(key){return String(key).startsWith('pytorch-ph:tour:')?'seen':read.call(this,key);};});
  const consent={learning_recommendations:false,officer_assistant:false,model_training:false};
  const writes=[];
  const api=await mockApi(context,{apiOrigin:'https://api.pytorch.ph',siteOrigin:site.origin,portalHandler:(_state,request,_url,path)=>{
    if(path==='/api/member/ai-consent') {
      if(request.method()==='PUT') {const input=request.postDataJSON();writes.push(input);consent[input.purpose]=input.granted;}
      return {status:200,body:{...consent}};
    }
    if(path==='/api/member/ai-policy')return {status:200,body:{version:'achievement-ai-v1',default:'deny',fields:{name:{sensitive_data:true,transform:'omit'}}}};
    return null;
  }});
  api.state.role='member';
  await context.route('https://accounts.google.com/**',route=>route.abort());
  const page=await context.newPage();
  const requests=[];
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('ai-consent'))requests.push({method:request.method(),path:new URL(request.url()).pathname});});
  await page.goto(`${site.origin}${PORTAL_BASE_PATH}/settings/`,{waitUntil:'networkidle'});
  const learning=page.getByRole('checkbox',{name:'Allow category-only learning recommendations',exact:true});
  await learning.waitFor();
  assert.equal(await learning.isChecked(),false);
  await Promise.all([page.waitForResponse(response=>response.url().includes('/member/ai-consent') && response.request().method()==='PUT',{timeout:10000}),learning.click()]).catch(async error=>{console.error(JSON.stringify({requests,writes,errors:errors.slice(-3),checked:await learning.isChecked(),toast:await page.locator('[data-sonner-toast]').allTextContents(),unexpected:api.unexpected.slice(-3)}));throw error;});
  await page.waitForFunction(element=>element.checked && !element.disabled,await learning.elementHandle());
  await Promise.all([page.waitForResponse(response=>response.url().includes('/member/ai-consent') && response.request().method()==='PUT'),learning.click()]);
  await page.waitForFunction(element=>!element.checked && !element.disabled,await learning.elementHandle());
  assert.deepEqual(writes,[{purpose:'learning_recommendations',granted:true},{purpose:'learning_recommendations',granted:false}]);
  const training=page.getByRole('checkbox',{name:'Model training enrollment is unavailable and stays off.',exact:true});
  assert.equal(await training.isDisabled(),true);
  assert.equal(await training.isChecked(),false);
  await page.getByText('Sensitive-field policy (YAML preview)',{exact:true}).click();
  const yaml=page.getByRole('textbox',{name:'Canonical AI field policy',exact:true});
  assert.equal(await yaml.getAttribute('readonly'),'');
  assert.match(await yaml.inputValue(),/sensitive_data: true/);
  assert.equal(writes.some(value=>value.purpose==='model_training'),false);
  console.log(JSON.stringify({event:'ai_privacy.browser.verified',outcome:'success',checks:['default-deny','independent-consent','withdrawal','training-disabled','canonical-yaml-readonly']}));
} finally {await browser?.close();await site.close();}
