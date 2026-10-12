import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
for(const name of await readdir(root)){
  if(!name.endsWith('.mjs'))continue;
  const result=spawnSync(process.execPath,['--check',resolve(root,name)],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status ?? 1);
}
const lint=spawnSync(process.execPath,[resolve(root,'../../node_modules/eslint/bin/eslint.js'),'--config',resolve(root,'eslint.config.mjs'),root],{stdio:'inherit'});
if(lint.status!==0)process.exit(lint.status ?? 1);
console.log(JSON.stringify({event:'officer_tools.syntax.passed'}));
