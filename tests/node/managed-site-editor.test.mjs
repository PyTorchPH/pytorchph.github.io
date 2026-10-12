import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { mockApi } from "../../development/pages-demo/verify/mock-api.mjs";
import { servePages } from "../../development/pages-demo/verify/serve-pages.mjs";

test("built officer editor saves drafts, shows pending approval and handles stale writes",async()=>{
  const root=resolve(import.meta.dirname,"../..");
  const site=await servePages({portalOut:resolve(root,"frontend/portal-static/out"),siteOut:resolve(root,"frontend/public-site/_site")});
  const document=JSON.parse(await readFile(resolve(root,"backend/api/seeds/site-content.json"),"utf8"));
  let view={revision:1,publishedRevision:1,document,approvals:0,requiredApprovals:2,canApprove:true};
  let stale=false;
  const executablePath=process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe","/usr/bin/chromium","/usr/bin/google-chrome"].find(existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const controls=await mockApi(context,{apiOrigin:"https://api.pytorch.ph",siteOrigin:site.origin,portalHandler:(_state,request,_url,path)=>{
      if(path!=="/api/officer/site-content" && path!=="/api/officer/site-content/approve")return null;
      if(request.method()==="GET")return {status:200,body:structuredClone(view)};
      const input=request.postDataJSON();
      if(stale || input.revision!==view.revision)return {status:409,body:{error:"Website draft changed; reload before saving or approving"}};
      if(request.method()==="PUT")view={...view,revision:view.revision+1,document:input.document,approvals:0};
      else view={...view,approvals:1}; // This browser represents one president; repeated clicks never add another vote.
      return {status:200,body:structuredClone(view)};
    }});
    controls.state.role="officer";
    const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`${site.origin}/portal/admin/website/`);
    await page.getByRole("heading",{name:"Website content",exact:true}).waitFor().catch(async error => {
      console.error(JSON.stringify({url:page.url(),title:await page.title(),body:(await page.locator("body").innerText({timeout:1000}).catch(()=>"")).slice(0,1200),errors,unexpected:controls.unexpected.slice(0,8)}));
      throw error;
    });
    const initialEventTitle=page.getByRole("group",{name:"PyTorch Fundamentals",exact:true}).first().getByLabel("title",{exact:true});
    const eventTitle=page.locator(`[id="${await initialEventTitle.getAttribute("id")}"]`);
    await eventTitle.fill("Edited event for isolated browser verification").catch(async error => { console.error(JSON.stringify({labels:(await page.locator("label").allTextContents()).slice(0,8),controls:await page.locator("textarea").count(),main:(await page.locator("main").innerText()).slice(0,1600)})); throw error; });
    assert.equal(await page.getByRole("button",{name:"Approve publication",exact:true}).isDisabled(),true);
    await page.getByRole("button",{name:"Save draft",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Draft saved."}).waitFor();
    assert.equal(view.document.events[0].title,"Edited event for isolated browser verification");
    assert.equal(view.publishedRevision,1);
    await page.getByRole("button",{name:"Approve publication",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Waiting for the remaining presidential approval."}).waitFor();
    assert.equal(view.approvals,1);assert.equal(view.publishedRevision,1);
    await eventTitle.fill("Unsaved next version");stale=true;
    await page.getByRole("button",{name:"Save draft",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Website draft changed"}).waitFor();
    assert.equal(await eventTitle.inputValue(),"Unsaved next version");
    const artifacts=resolve(root,"var/test-artifacts");await mkdir(artifacts,{recursive:true});
    await page.screenshot({path:resolve(artifacts,"site-content-editor-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    // AppShell animates padding for 200 ms; evaluate mobile geometry after that transition settles.
    await page.locator("main").evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
    const overflow=await page.evaluate(()=>window.document.documentElement.scrollWidth>innerWidth);
    if(overflow)console.error(JSON.stringify(await page.evaluate(()=>[...window.document.querySelectorAll("main *")].map(el=>({tag:el.tagName,classes:el.className,right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width)})).filter(x=>x.right>innerWidth+1).slice(0,10))));
    assert.equal(overflow,false);
    await page.screenshot({path:resolve(artifacts,"site-content-editor-mobile.png"),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(controls.unexpected,[]);
  }finally{await browser.close();await site.close();}
});
