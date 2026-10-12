import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

// This exercises the actual runtime renderer with isolated published API data, never a live API.
test("published community content renders safely, sorts real events and refreshes without a rebuild", async () => {
  const source=await readFile(new URL("../../frontend/public-site/assets/site-content.js",import.meta.url),"utf8");
  const baseline=JSON.parse(await readFile(new URL("../../backend/api/seeds/site-content.json",import.meta.url),"utf8"));
  let revision=2;
  const document=structuredClone(baseline);
  document.branding.tagline="Uploaded community update <img src=x onerror=window.xss=1>";
  document.contacts.facebook="https://www.facebook.com/example";
  document.events=[
    {id:"later",title:"Later training",topic:"Vision",startsAt:"2099-03-01",dateStatus:"confirmed",eventType:"training",venue:"Online",registrationUrl:"https://example.org/register"},
    {id:"soon",title:"Coming program",topic:"PyTorch",startsAt:"",dateStatus:"coming_soon",eventType:"program",venue:"",registrationUrl:""},
    {id:"earlier",title:"Earlier training",topic:"Basics",startsAt:"2099-01-01",dateStatus:"tentative",eventType:"training",venue:"Online",registrationUrl:"javascript:alert(1)"},
  ];
  document.articles=[{id:"recap",title:"Recorded event",kind:"recap",publishedAt:"2026-10-12",eventDate:"2026-10-01",venue:"Online",speakers:"A speaker",topics:"PyTorch",highlights:"<script>window.xss=1</script>",takeaways:"A learning outcome",acknowledgments:"Organizers",photoUrl:""}];
  document.chapters=[{id:"chapter",university:"A verified test institution",chapter:"Local chapter",island:"Luzon",status:"active",photoUrl:""}];
  const targets=["tagline","description","about","leadership-ambassador","leadership-core","leadership-department","events","news","recaps","chapters-Luzon","chapters-Visayas","chapters-Mindanao","contacts"];
  const server=createServer((request,response)=>{
    const name=request.url;
    if(name==="/renderer.js"){response.setHeader("Content-Type","application/javascript");response.end(source);}
    else if(name==="/defaults.json"||name==="/public/site-content"){response.setHeader("Content-Type","application/json");response.end(JSON.stringify(name==="/defaults.json" ? baseline : {revision,document}));}
    else {response.setHeader("Content-Type","text/html");response.end(`<!doctype html><html><body>${targets.map(key=>`<div data-site-content="${key}"></div>`).join("")}<script src="/renderer.js" data-api="/public/site-content" data-defaults="/defaults.json"></script></body></html>`);}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const executablePath=process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe","/usr/bin/chromium","/usr/bin/google-chrome"].find(existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
  try {
    const page=await browser.newPage();
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.documentElement.dataset.siteContentRevision==="2");
    assert.equal(await page.locator('[data-site-content="tagline"]').textContent(),document.branding.tagline);
    assert.equal(await page.evaluate(()=>window.xss),undefined);
    assert.equal(await page.locator('[data-site-content="recaps"] script').count(),0);
    assert.deepEqual(await page.locator('[data-site-content="events"] h3').allTextContents(),["Earlier training","Later training","Coming program"]);
    assert.match(await page.locator('[data-site-content="events"]').textContent(),/Tentative/);
    assert.match(await page.locator('[data-site-content="events"]').textContent(),/Coming Soon/);
    assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
    assert.match(await page.locator('[data-site-content="chapters-Luzon"]').textContent(),/Local chapter/);
    assert.match(await page.locator('[data-site-content="chapters-Visayas"]').textContent(),/No participating chapters/);
    revision=3;document.branding.tagline="Newly published community update";
    await page.evaluate(()=>window.document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(()=>document.documentElement.dataset.siteContentRevision==="3");
    assert.equal(await page.locator('[data-site-content="tagline"]').textContent(),document.branding.tagline);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
});
