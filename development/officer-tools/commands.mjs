import { z } from 'zod';
import { PortalError } from './api-client.mjs';

const views={events:'events',organization:'organization',demographics:'demographics',evidence:'evidence',appeals:'evidence/appeals',skills_pending:'skills/pending',skills_raw:'skills/raw',mail_collab:'mail-collab'};
const revision=z.number().int().positive();

export function commandCatalog(client) {
  return {
    identity:{description:'Read the authenticated officer identity.',schema:z.object({}).strict(),readOnly:true,run:()=>client.identity()},
    officer_read:{description:'Read an allowlisted officer view using current server permissions.',schema:z.object({view:z.enum(Object.keys(views))}).strict(),readOnly:true,run:async({view})=>{await client.identity();return client.request('/portal/api/officer/'+views[view]);}},
    website_get_draft:{description:'Read the website draft, its revision and current presidential approval count.',schema:z.object({}).strict(),readOnly:true,run:async()=>{await client.identity();return client.request('/portal/api/officer/site-content');}},
    website_save_draft:{description:'Save a complete website draft with an expected revision. Requires explicitly enabled writes; does not publish.',schema:z.object({revision,document:z.record(z.string(),z.unknown())}).strict(),readOnly:false,run:async(input)=>{requireWrites(client);await client.identity();return client.request('/portal/api/officer/site-content',{method:'PUT',body:input});}},
    website_approve:{description:'Approve one exact draft revision as the signed-in current president. Requires confirm=true and enabled writes; server enforces distinct-president quorum.',schema:z.object({revision,confirm:z.literal(true)}).strict(),readOnly:false,run:async({revision})=>{requireWrites(client);await client.identity();return client.request('/portal/api/officer/site-content/approve',{method:'POST',body:{revision}});}},
  };
}

export async function executeCommand(catalog,name,input={}) {
  const command=catalog[name];if(!command)throw new Error('Unknown officer command');
  return command.run(command.schema.parse(input));
}

function requireWrites(client) {
  if(!client.config.enableWrites)throw new PortalError(403,'Writes are disabled; explicitly enable them before this action');
}
