import { z } from 'zod';
import { PortalError } from './api-client.mjs';

const views={events:'events',organization:'organization',demographics:'demographics',evidence:'evidence',appeals:'evidence/appeals',skills_pending:'skills/pending',skills_raw:'skills/raw',mail_collab:'mail-collab'};
const revision=z.number().int().positive();

export function commandCatalog(client,{humanRaw=false}={}) {
  return {
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
