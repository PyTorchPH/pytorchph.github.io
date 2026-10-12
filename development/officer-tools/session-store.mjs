import { createHash,randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod,lstat,mkdir,readFile,rename,unlink,writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const execute=promisify(execFile);

export class SessionStore {
  constructor(directory,apiOrigin) {
    this.directory=directory;this.apiOrigin=apiOrigin;
    this.file=join(directory,createHash('sha256').update(apiOrigin).digest('hex').slice(0,24)+'.json');
  }

  async read() {
    try {
      const metadata=await lstat(this.file);
      if(!metadata.isFile() || metadata.isSymbolicLink() || metadata.size>4096)throw new Error('Invalid local session file');
      const value=JSON.parse(await readFile(this.file,'utf8'));
      if(value.apiOrigin!==this.apiOrigin)throw new Error('Local session belongs to another API origin');
      return validateCookie(value.cookie);
    }catch(error){if(error.code==='ENOENT')return undefined;throw new Error('Local session could not be read securely',{cause:error});}
  }

  async write(cookie) {
    validateCookie(cookie);
    await mkdir(this.directory,{recursive:true,mode:0o700});
    if((await lstat(this.directory)).isSymbolicLink())throw new Error('Credential directory cannot be a symbolic link');
    await protectDirectory(this.directory);
    const temporary=join(this.directory,randomUUID()+'.tmp');
    try {
      await writeFile(temporary,JSON.stringify({apiOrigin:this.apiOrigin,cookie}),{mode:0o600,flag:'wx'});
      await rename(temporary,this.file);
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }

  async clear() {
    await unlink(this.file).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}

export function validateCookie(value) {
  if(typeof value!=='string' || !/^ph_session=[a-fA-F0-9]{64}$/.test(value))throw new Error('Expected one valid ph_session cookie');
  return value;
}

async function protectDirectory(directory) {
  if(process.platform==='win32') {
    const account=`${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    if(!process.env.USERDOMAIN || !process.env.USERNAME)throw new Error('Cannot determine Windows credential-file owner');
    await execute('icacls',[directory,'/inheritance:r','/grant:r',`${account}:(OI)(CI)F`],{windowsHide:true});
  }else{await chmod(directory,0o700);}
}
