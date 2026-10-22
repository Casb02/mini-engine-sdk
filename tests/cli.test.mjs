import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = new URL('../bin/create-mini-game.mjs', import.meta.url);
const run = args => spawnSync(process.execPath, [cli.pathname,...args],{encoding:'utf8'});

test('CLI scaffolds all roles, compatible manifest and parseable browser module', async () => {
  const parent=await mkdtemp(join(tmpdir(),'mini-game-'));
  try {
    const target=join(parent,'team-vote');
    const result=run(['team-vote','--directory',target]);
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(await readFile(join(target,'manifest.json'),'utf8'));
    assert.equal(manifest.id,'team-vote');
    assert.equal(manifest.runtime,'host');
    assert.deepEqual(manifest.host_modes,['moderator']);
    assert.equal(manifest.settings_schema.additionalProperties,false);
    for (const role of ['host','player','display']) {
      const html=await readFile(join(target,`${role}.html`),'utf8');
      assert.match(html,new RegExp(`data-role="${role}"`));
      assert.match(html,/\/games\/team-vote\/assets\/app.js/);
    }
    const app=await readFile(join(target,'assets/app.js'),'utf8');
    assert.match(app,/from '\/sdk\/mini-engine.js'/);
    assert.match(app,/client.ready/);
    assert.match(app,/queue = queue/);
    assert.match(app,/textContent/);
    const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:app,encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr);
    assert.match(await readFile(join(target,'README.md'),'utf8'),/host-runtime/);
  } finally { await rm(parent,{recursive:true,force:true}); }
});

test('CLI refuses traversal, unknown flags, missing directory values and existing files', async () => {
  assert.notEqual(run(['../escape']).status,0);
  assert.notEqual(run(['vote','--force']).status,0);
  assert.notEqual(run(['vote','--directory']).status,0);
  assert.notEqual(run(['a'.repeat(49)]).status,0);
  const parent=await mkdtemp(join(tmpdir(),'mini-game-'));
  try {
    assert.notEqual(run(['vote','--directory',join(parent,'different-name')]).status,0);
    const target=join(parent,'vote'); await mkdir(target); await writeFile(join(target,'keep.txt'),'untouched');
    const result=run(['vote','--directory',target]);
    assert.notEqual(result.status,0);
    assert.equal(await readFile(join(target,'keep.txt'),'utf8'),'untouched');
    assert.equal(run(['--help']).status,0);
  } finally { await rm(parent,{recursive:true,force:true}); }
});

test('generated games type-check their /sdk/mini-engine.js import and report SDK misuse', async () => {
  const parent=await mkdtemp(join(tmpdir(),'mini-game-types-'));
  const tsc=fileURLToPath(new URL('../node_modules/typescript/bin/tsc',import.meta.url));
  const check=directory=>spawnSync(process.execPath,[tsc,'-p',join(directory,'jsconfig.json')],{encoding:'utf8'});
  try {
    const target=join(parent,'typed-vote');
    assert.equal(run(['typed-vote','--directory',target]).status,0);
    assert.equal(await readFile(join(target,'types/mini-engine.d.ts'),'utf8'),await readFile(new URL('../types/mini-engine.d.ts',import.meta.url),'utf8'));
    const jsconfig=JSON.parse(await readFile(join(target,'jsconfig.json'),'utf8'));
    assert.equal(jsconfig.compilerOptions.checkJs,true);
    const valid=check(target);
    assert.equal(valid.status,0,valid.stdout+valid.stderr);
    const app=join(target,'assets/app.js');
    const source=await readFile(app,'utf8');
    await writeFile(app,source.replace("client.lifecycle('finished')","client.lifecycle('done')").replace('room.settings.prompt;','room.settings.promt;'));
    const invalid=check(target);
    assert.notEqual(invalid.status,0);
    assert.match(invalid.stdout,/'"done"' is not assignable to parameter of type 'Lifecycle'/);
    assert.match(invalid.stdout,/Property 'promt' does not exist on type 'Settings'/);
  } finally { await rm(parent,{recursive:true,force:true}); }
});
