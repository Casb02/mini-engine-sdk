import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'mini-sdk-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd = directory) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
try {
  run(npm, ['pack', '--pack-destination', directory], root);
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const tarball = join(directory, `casb02-mini-engine-sdk-${version}.tgz`);
  await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  run(process.execPath, ['--input-type=module', '-e', "import { MiniEngine, ApiClient, sessionKey } from '@casb02/mini-engine-sdk'; if (typeof MiniEngine !== 'function' || typeof ApiClient !== 'function' || sessionKey('abcdef','host') !== 'mini-engine:ABCDEF:host' || new MiniEngine({code:'ABCDEF',token:'secret'}).realtime.emit('ping') !== false) throw Error('bad exports');"]);
  run(npm, ['exec', '--offline', '--', 'create-mini-game', 'packed-vote']);
  const manifest = JSON.parse(await readFile(join(directory, 'packed-vote/manifest.json'), 'utf8'));
  if (manifest.id !== 'packed-vote') throw new Error('Packed CLI did not generate the game');
  await writeFile(join(directory, 'consumer.ts'), "import { MiniEngine, type Snapshot } from '@casb02/mini-engine-sdk'; const engine = new MiniEngine<{votes:number}, {prompt:string}>({code:'ABCDEF',token:'secret'}); engine.on('snapshot', room => { const prompt: string = room.settings.prompt; void prompt; }); void engine; let snapshot: Snapshot | null = null; void snapshot;\n");
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', 'consumer.ts']);
  console.log('Packed artifact installed without scripts; ESM exports, declarations and installed CLI work.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
