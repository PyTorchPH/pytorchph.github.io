import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';

export async function privateInput(prompt,{stdin=false}={}) {
  if(stdin) {
    let value='';for await(const chunk of process.stdin){value+=chunk;if(Buffer.byteLength(value)>4096)throw new Error('Secret input too large');}
    return value.replace(/\r?\n$/,'');
  }
  if(!process.stdin.isTTY)throw new Error('Secret input needs a terminal or an explicit --password-stdin/--session-stdin flag');
  const output=new Writable({write(_chunk,_encoding,callback){callback();}});
  const input=createInterface({input:process.stdin,output,terminal:true});
  process.stderr.write(prompt);
  try {return await input.question('');}
  finally{input.close();process.stderr.write('\n');}
}
