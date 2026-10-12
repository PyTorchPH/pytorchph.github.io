import { readFile,stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { configuration } from './config.mjs';
import { PortalClient,PortalError } from './api-client.mjs';
import { commandCatalog,executeCommand } from './commands.mjs';
import { privateInput } from './private-input.mjs';

// Mental model: CLI options select the same command catalog exposed by MCP; credentials never become arguments/results.
async function main() {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{email:{type:'string'},file:{type:'string'},revision:{type:'string'},write:{type:'boolean'},confirm:{type:'boolean'},'password-stdin':{type:'boolean'},'session-stdin':{type:'boolean'}}});
  const [action,argument]=positionals;
  if(!action || action==='help')return {commands:['login --email EMAIL [--password-stdin]','import-session [--session-stdin]','logout','identity','read VIEW','website-draft','website-save --file FILE --write','website-approve --revision N --write --confirm'],views:['events','organization','demographics','evidence','appeals','skills_pending','skills_raw','mail_collab'],note:'Login requires an existing approved officer account. Writes use the live API and existing presidential quorum.'};
  const config=configuration();if(values.write)config.enableWrites=true;
  const client=new PortalClient(config);const catalog=commandCatalog(client);
  switch(action) {
    case 'login':if(!values.email)throw new Error('--email is required');return client.login(values.email,await privateInput('Password: ',{stdin:values['password-stdin']}));
    case 'import-session':return client.importSession(await privateInput('Session cookie: ',{stdin:values['session-stdin']}));
    case 'logout':return client.logout();
    case 'identity':return executeCommand(catalog,'identity');
    case 'read':return executeCommand(catalog,'officer_read',{view:argument});
    case 'website-draft':return executeCommand(catalog,'website_get_draft');
    case 'website-save':return executeCommand(catalog,'website_save_draft',await readDraft(values.file));
    case 'website-approve':return executeCommand(catalog,'website_approve',{revision:Number(values.revision),confirm:values.confirm});
    default:throw new Error('Unknown command; run help');
  }
}

async function readDraft(file) {
  if(!file || (await stat(file)).size>128*1024)throw new Error('A JSON draft file under 128 KiB is required');
  const value=JSON.parse(await readFile(file,'utf8'));return {revision:value.revision,document:value.document};
}

try{console.log(JSON.stringify(await main(),null,2));}
catch(error){console.error(JSON.stringify({event:'officer_tools.cli.failed',status:error instanceof PortalError ? error.status : 0,message:error instanceof PortalError ? error.message : 'Invalid command/input; run help'}));process.exitCode=1;}
