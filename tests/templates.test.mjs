import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, gameFiles, resolveOptions, templateList } from '../bin/templates.mjs';

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const run = (args, cwd) => new Promise(resolve => {
  const child = spawn(process.execPath, args, { cwd });
  let out = '';
  child.stdout.on('data', chunk => (out += chunk));
  child.stderr.on('data', chunk => (out += chunk));
  child.on('close', code => resolve({ code, out }));
});
const idsIn = html => new Set([...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]));
const idsUsed = source => new Set([...source.matchAll(/(?:\$|button)\('([^']+)'\)/g)].map(match => match[1]));

async function write(root, slug, options) {
  const dir = join(root, slug);
  for (const [name, content] of Object.entries(gameFiles(slug, options))) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

for (const name of Object.keys(TEMPLATES)) {
  test(`${name}: both looks and languages scaffold a game that type-checks and passes its own tests`, async () => {
    const root = await mkdtemp(join(tmpdir(), `mini-template-${name}-`));
    try {
      const variants = [{ look: 'mini-engine-ui', language: 'nl' }, { look: 'plain', language: 'en' }];
      await Promise.all(variants.map(async (variant, index) => {
        const slug = `${name}-${index}`;
        const options = { template: name, ...variant };
        const files = gameFiles(slug, options);
        const manifest = JSON.parse(files['manifest.json']);
        assert.equal(manifest.runtime, 'host');
        assert.deepEqual(manifest.host_modes, ['playing', 'tv']);
        assert.equal(manifest.default_host_mode, 'playing');
        assert.equal(manifest.icon, 'assets/icon.svg');
        const icon = String(files['assets/icon.svg']);
        assert.match(icon, /^<svg[^>]+viewBox="0 0 48 48"/);
        assert.doesNotMatch(icon, /<script|<foreignobject|javascript:|\son[a-z]+\s*=|<text/i);
        for (const file of ['.meignore', 'jsconfig.json', 'README.md', 'tests/logic.test.mjs', 'assets/logic.js', 'assets/texts.js', 'types/mini-engine.d.ts']) assert.ok(files[file], `${slug} has ${file}`);
        assert.equal(Boolean(files['assets/ui/mini-engine-ui.css']), variant.look === 'mini-engine-ui');
        const scripts = `${files['assets/app.js']}\n${files['assets/room.js']}`;
        const pages = ['host.html', 'player.html', ...(manifest.has_display ? ['display.html'] : [])];
        for (const page of pages) {
          assert.match(files[page], new RegExp(`<html lang="${variant.language}">`));
          const present = idsIn(files[page]);
          for (const id of idsUsed(scripts)) if (!(page === 'display.html' && id === 'show-qr')) assert.ok(present.has(id), `${slug} ${page} has #${id}`);
        }
        for (const key of new Set([...scripts.matchAll(/\bt\.(\w+)/g)].map(match => match[1]))) {
          assert.match(String(files['assets/texts.js']), new RegExp(`^  ${key}:`, 'm'), `${slug} texts.js has ${key}`);
        }
        const dir = await write(root, slug, options);
        const checked = await run([tsc, '-p', join(dir, 'jsconfig.json')]);
        assert.equal(checked.code, 0, checked.out);
        const tested = await run(['--test', 'tests/logic.test.mjs'], dir);
        assert.equal(tested.code, 0, tested.out);
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('every template has the same words in Dutch and English', () => {
  for (const template of Object.values(TEMPLATES)) assert.deepEqual(Object.keys(template.texts.nl).sort(), Object.keys(template.texts.en).sort(), template.name);
  assert.deepEqual(templateList('nl').map(template => template.name), ['stemmen', 'quiz', 'buzzer', 'beurten', 'leeg']);
});

test('options: defaults, players, host modes and refusals', () => {
  const plain = resolveOptions('mijn-spel');
  assert.deepEqual([plain.template, plain.language, plain.look, plain.title], ['stemmen', 'en', 'plain', 'Mijn Spel']);
  const chosen = resolveOptions('kwis', { template: 'quiz', title: ' Pubquiz ', minPlayers: 2, maxPlayers: 6, hostModes: ['tv', 'playing'] });
  assert.deepEqual([chosen.title, chosen.minPlayers, chosen.maxPlayers, chosen.theme], ['Pubquiz', 2, 6, 'studio']);
  const manifest = JSON.parse(gameFiles('kwis', { template: 'quiz', minPlayers: 2, maxPlayers: 6, hostModes: ['tv'] })['manifest.json']);
  assert.deepEqual([manifest.min_players, manifest.max_players, manifest.host_modes, manifest.default_host_mode], [2, 6, ['tv'], 'tv']);
  assert.match(gameFiles('kwis', { template: 'quiz', minPlayers: 3 })['assets/logic.js'], /^export const MIN_PLAYERS = 3;$/m);
  assert.throws(() => resolveOptions('kwis', { template: 'nope' }), /Unknown template/);
  assert.throws(() => resolveOptions('kwis', { hostModes: ['moderator'] }), /Host modes/);
  assert.throws(() => resolveOptions('kwis', { minPlayers: 5, maxPlayers: 2 }), /Players/);
  assert.throws(() => resolveOptions('2kwis'), /Slug/);
  assert.throws(() => resolveOptions('kwis', { title: 'a\nb' }), /Title/);
  assert.match(String(gameFiles('kwis', { title: '<b>Kwis & co</b>' })['host.html']), /<title>&lt;b&gt;Kwis &amp; co&lt;\/b&gt;<\/title>/);
});
