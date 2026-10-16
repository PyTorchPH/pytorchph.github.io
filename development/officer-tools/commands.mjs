import { z } from 'zod';
import { PortalError } from './api-client.mjs';

const views={events:'events',organization:'organization',demographics:'demographics',evidence:'evidence',appeals:'evidence/appeals',skills_pending:'skills/pending',skills_raw:'skills/raw',mail_collab:'mail-collab'};
const revision=z.number().int().positive();

export function commandCatalog(client,{humanRaw=false}={}) {
  return {
    event_schedule_list:{description:"Ilista ang published learning schedules; public metadata lang, may consent at pagination.",schema:z.object({after:z.string().max(80).regex(/^[a-z0-9_-]*$/).optional()}).strict(),readOnly:true,run:({after})=>client.aiView("event_schedules/"+(after ?? ""))},
    event_schedule_create:{description:"Idagdag ang public learning schedule nang walang duplicate. Kailangan ng publication grant, consent, write opt-in at confirmation; walang overwrite.",schema:z.object({id:z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/),title:z.string().trim().min(1).max(200),startsAt:z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/),series:z.string().trim().min(1).max(200),modules:z.string().trim().min(1).max(1000),confirm:z.literal(true)}).strict(),readOnly:false,idempotent:true,destructive:false,run:async input=>{requireWrites(client);await client.aiView("identity");return client.request("/portal/api/officer/event-schedules",{method:"POST",body:input});}},
    identity:{description:'Read purpose-consented pseudonymous officer identity; real name/id stay out of agent context.',schema:z.object({}).strict(),readOnly:true,run:()=>humanRaw ? client.identity() : client.aiView('identity')},
    officer_read:{description:'Read purpose-filtered officer counts; small groups are suppressed. Unreviewed views are blocked.',schema:z.object({view:z.enum(Object.keys(views))}).strict(),readOnly:true,run:async({view})=>{if(!humanRaw)return client.aiView(view);await client.identity();return client.request('/portal/api/officer/'+views[view]);}},
    website_get_draft:{description:'No reviewed AI policy for website drafts; use explicit human CLI mode.',schema:z.object({}).strict(),readOnly:true,run:async()=>{requireHuman(humanRaw);await client.identity();return client.request('/portal/api/officer/site-content');}},
    website_save_draft:{description:'Requires human CLI mode; website drafts are not approved as AI input.',schema:z.object({revision,document:z.record(z.string(),z.unknown())}).strict(),readOnly:false,run:async(input)=>{requireHuman(humanRaw);requireWrites(client);await client.identity();return client.request('/portal/api/officer/site-content',{method:'PUT',body:input});}},
    website_approve:{description:'Requires human CLI mode; current-president quorum remains authoritative.',schema:z.object({revision,confirm:z.literal(true)}).strict(),readOnly:false,run:async({revision})=>{requireHuman(humanRaw);requireWrites(client);await client.identity();return client.request('/portal/api/officer/site-content/approve',{method:'POST',body:{revision}});}},
  };
}

function requireHuman(humanRaw) {
  if(!humanRaw)throw new PortalError(403,'No reviewed AI policy for this workflow; use --human-raw only outside an AI/agent context');
}

export async function executeCommand(catalog,name,input={}) {
  const command=catalog[name];if(!command)throw new Error('Unknown officer command');
  return command.run(command.schema.parse(input));
}

function requireWrites(client) {
  if(!client.config.enableWrites)throw new PortalError(403,'Writes are disabled; explicitly enable them before this action');
}
