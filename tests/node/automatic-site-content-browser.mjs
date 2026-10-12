import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { mockApi } from '../../development/pages-demo/verify/mock-api.mjs';
import { servePages } from '../../development/pages-demo/verify/serve-pages.mjs';
import { PORTAL_BASE_PATH } from '../../development/pages-demo/portal-base-path.mjs';

// Synthetic browser integration: canonical saved-event contract, tabs and actual public renderer.
const root=resolve(import.meta.dirname,'../..');
const site=await servePages({portalOut:resolve(root,'frontend/portal-static/out'),siteOut:resolve(root,'frontend/public-site')});
let browser;
try {
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
 browser=await chromium.launch({headless:true,executablePath:process.env.PH_DEMO_BROWSER || (existsSync(chrome)?chrome:undefined)});
 const context=await browser.newContext();
 await context.addInitScript(()=>{const read=Storage.prototype.getItem;Storage.prototype.getItem=function(key){return String(key).startsWith('pytorch-ph:tour:')?'seen':read.call(this,key);};});
 const document={leadership:[],chapters:[],events:[],articles:[]};
 const api=await mockApi(context,{apiOrigin:'https://api.pytorch.ph',siteOrigin:site.origin,portalHandler:(_state,_request,_url,path)=>{
   if(path==='/api/officer/site-content')return {status:200,body:{revision:1,publishedRevision:1,document,approvals:0,requiredApprovals:2,canApprove:false}};
   if(path==='/api/officer/events')return {status:200,body:{events:[{id:'demo-event',title:'Synthetic PyTorch workshop',category:'workshop',startsAt:'2027-02-01',isPublic:true,isDemo:true}]}};
   return null;
 }});
 api.state.role='officer';
 await context.route('https://accounts.google.com/**',route=>route.abort());
 const page=await context.newPage();
 await page.goto(`${site.origin}${PORTAL_BASE_PATH}/admin/website/`,{waitUntil:'networkidle'});
 await page.getByRole('tab',{name:'Events & Programs',exact:true}).waitFor();
 assert.equal(await page.getByText('Synthetic PyTorch workshop',{exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Add entry',exact:true}).count(),0);
 await page.getByRole('tab',{name:'News & Recaps',exact:true}).click();
 await page.getByRole('button',{name:'Add entry',exact:true}).click();
 await page.getByLabel('title',{exact:true}).fill('Unsaved synthetic recap');
 await page.getByRole('tab',{name:'Events & Programs',exact:true}).click();
 await page.getByRole('tab',{name:'News & Recaps',exact:true}).click();
 assert.equal(await page.getByLabel('title',{exact:true}).inputValue(),'Unsaved synthetic recap');
 await context.close();

 const publicContext=await browser.newContext();
 const bundle={revision:1,document:{leadership:[],chapters:[],events:[{id:'demo',title:'Synthetic PyTorch workshop',description:'Learn from this synthetic saved-event description.',eventType:'workshop',startsAt:'2027-02-01',dateStatus:'confirmed',isDemo:true}],articles:[]}};
 await publicContext.route('https://api.pytorch.ph/public/site-content',route=>route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify(bundle)}));
 const publicPage=await publicContext.newPage();
 await publicPage.goto(`${site.origin}/assets/site-content-defaults.json`);
 await publicPage.setContent('<div data-site-content="leadership-ambassador"></div><div data-site-content="leadership-core"></div><div data-site-content="leadership-department"></div><div data-site-content="campus-leads"></div><div data-site-content="events"></div><div data-site-content="chapters-Luzon"></div><div data-site-content="chapters-Visayas"></div><div data-site-content="chapters-Mindanao"></div><script id="content"></script>');
 await publicPage.evaluate(({code,origin})=>{const script=document.createElement('script');script.dataset.api='https://api.pytorch.ph/public/site-content';script.dataset.defaults=`${origin}/assets/site-content-defaults.json`;script.textContent=code;document.body.append(script);},{code:readFileSync(resolve(root,'frontend/public-site/assets/site-content.js'),'utf8'),origin:site.origin});
 await publicPage.getByText('Synthetic PyTorch workshop',{exact:true}).waitFor();
 assert.equal(await publicPage.getByText('Demo/Test event — sample data',{exact:true}).count(),1);
 assert.equal(await publicPage.getByText('Learn from this synthetic saved-event description.',{exact:true}).count(),1);
 assert.equal(await publicPage.locator('[data-site-content="leadership-ambassador"] img').count(),0);
 const defaults=JSON.parse(readFileSync(resolve(root,'frontend/public-site/assets/site-content-defaults.json'),'utf8'));
 assert.deepEqual(defaults.leadership,[]);assert.deepEqual(defaults.chapters,[]);assert.deepEqual(defaults.events,[]);
 console.log(JSON.stringify({event:'automatic_site_content.browser.verified',outcome:'success',checks:['canonical-events','demo-label','no-manual-directories','tabs-preserve-draft','no-placeholder-fallback']}));
} finally {await browser?.close();await site.close();}
