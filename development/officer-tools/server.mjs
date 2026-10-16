import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { configuration } from './config.mjs';
import { PortalClient,PortalError } from './api-client.mjs';
import { commandCatalog } from './commands.mjs';
import { pathToFileURL } from 'node:url';

export function createOfficerServer(client) {
  const server=new McpServer({name:'pytorch-ph-officer',version:'0.1.0'});
  for(const [name,command] of Object.entries(commandCatalog(client))) {
    server.registerTool(name,{description:command.description,inputSchema:command.schema,annotations:{readOnlyHint:command.readOnly,destructiveHint:command.destructive ?? !command.readOnly,idempotentHint:command.idempotent ?? command.readOnly,openWorldHint:false}},async input=>{
      try {const result=await command.run(input);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}};}
      catch(error){client.log({event:'officer_tools.command.failed',at:new Date().toISOString(),component:'officer_tools',operation:name,status:error instanceof PortalError ? error.status : 0});return {isError:true,content:[{type:'text',text:error instanceof PortalError ? error.message : 'Officer command failed validation or execution'}]};}
    });
  }
  return server;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const server=createOfficerServer(new PortalClient(configuration()));
    await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:256*1024}));
  }catch{process.stderr.write(JSON.stringify({event:'officer_tools.start.failed',component:'officer_tools',message:'MCP configuration or startup failed'})+'\n');process.exitCode=1;}
}
