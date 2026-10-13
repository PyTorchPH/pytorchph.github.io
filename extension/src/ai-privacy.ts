export type ProjectionTicket = {id:string;proof:string};
export type ApprovedAiRequest = {system?:string;prompt:string;maxTokens:number;json?:boolean};

/** Only the backend supplies personal-data prompts. A capability never chooses its verification origin. */
export async function approvedRequest(request: {system?:string;prompt?:string;maxTokens?:number;json?:boolean;ticket?:ProjectionTicket}): Promise<ApprovedAiRequest> {
  if(request.prompt==="Reply with the single word READY." && !request.system && request.maxTokens===10 && !request.json && !request.ticket) return {prompt:request.prompt,maxTokens:10};
  if(!request.ticket || Object.keys(request).some(key=>key!=="ticket") || !/^[a-f0-9-]{36}$/.test(request.ticket.id) || !/^[a-f0-9]{64}$/.test(request.ticket.proof))throw new Error("A backend-approved AI projection is required. Raw personal-data prompts are blocked.");
  const response=await fetch("https://api.pytorch.ph/public/ai-projection/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request.ticket),credentials:"omit",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error("AI projection is expired, revoked or unavailable.");
  const reader=response.body?.getReader();if(!reader)throw new Error("Empty AI projection.");
  const chunks:Uint8Array[]=[];let bytes=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>128*1024)throw new Error("AI projection exceeds the byte limit.");chunks.push(value);}}finally{await reader.cancel();}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder().decode(buffer);
  const value=JSON.parse(text) as Partial<ApprovedAiRequest>;
  if(typeof value.prompt!=="string" || typeof value.system!=="string" || value.maxTokens!==1200 || value.json!==true)throw new Error("Invalid backend AI projection.");
  return {prompt:value.prompt,system:value.system,maxTokens:1200,json:true};
}
