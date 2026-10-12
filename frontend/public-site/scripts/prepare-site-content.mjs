import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root=new URL("../../../",import.meta.url);
try { process.loadEnvFile(fileURLToPath(new URL(".env",root))); } catch(error) { if(error.code!=="ENOENT") throw error; }
const data=JSON.parse(await readFile(new URL("backend/api/seeds/site-content.json",root),"utf8"));
// Live directories/events have one backend source; never resurrect manual seed profiles on failure.
for(const collection of ["leadership","chapters","events"])data[collection]=[];
const contacts={};
for(const [key,variable] of [["facebook","PUBLIC_SITE_FACEBOOK_URL"],["linkedin","PUBLIC_SITE_LINKEDIN_URL"],["email","PUBLIC_SITE_CONTACT_EMAIL"]]) {
 const value=process.env[variable] ?? "";
 if(value && key!=="email") { const url=new URL(value); if(url.protocol!=="https:" || url.username || url.password) throw new Error(`${variable} must be an HTTPS URL without credentials`); }
 if(value && key==="email" && !/^[^\s@?&#]+@[^\s@?&#]+$/.test(value)) throw new Error("Invalid PUBLIC_SITE_CONTACT_EMAIL");
 if(value) contacts[key]=value;
}
await writeFile(new URL("../assets/site-content-defaults.json",import.meta.url),JSON.stringify(data,null,2)+"\n");
await writeFile(new URL("../_data/public_contacts.json",import.meta.url),JSON.stringify(contacts,null,2)+"\n");
console.log(JSON.stringify({event:"site_content.build_defaults_ready",public_fields:3}));
