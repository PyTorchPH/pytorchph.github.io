import { createInterface } from 'node:readline/promises';

export async function loginChoice(method,email) {
  if(method && !['email','google'].includes(method))throw new Error('Piliin ang --method email o --method google');
  if(method || email)return {method:method ?? 'email',email};
  if(!process.stdin.isTTY)throw new Error('Gamitin ang login --method google o login --method email --email EMAIL');
  const input=createInterface({input:process.stdin,output:process.stderr});
  try {
    const answer=(await input.question('Paano ka mag-login? [1] Email  [2] Google: ')).trim();
    if(answer==='2')return {method:'google'};
    if(answer!=='1')throw new Error('Piliin ang 1 o 2');
    return {method:'email',email:(await input.question('Email: ')).trim()};
  }finally{input.close();}
}
