import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skills = fileURLToPath(new URL('../skills/', import.meta.url));

test('agent skills have valid SKILL.md frontmatter and only reference files that exist', async () => {
  const names = (await readdir(skills, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  assert.ok(names.length >= 2, 'expected the game-building skills');
  for (const name of names) {
    const text = await readFile(join(skills, name, 'SKILL.md'), 'utf8');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, `${name}: SKILL.md starts with YAML frontmatter`);
    const fields = Object.fromEntries(frontmatter[1].split('\n').map(line => line.match(/^([a-z-]+):\s*(.*)$/)).filter(Boolean).map(match => [match[1], match[2]]));
    assert.equal(fields.name, name, `${name}: name matches its directory`);
    assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(fields.description?.startsWith('Use when'), `${name}: description states when to use it`);
    assert.ok(frontmatter[1].length <= 1024, `${name}: frontmatter stays within 1024 characters`);
    // Paths are relative to the skill, or to the skills root when they name another skill.
    for (const [, other, path] of text.matchAll(/`((?:[a-z0-9-]+\/)?)((?:references|scripts|kit)\/[\w./-]+)`/g)) {
      await access(join(skills, other ? other.slice(0, -1) : name, path));
    }
  }
});

test('skill scripts are syntactically valid modules', async () => {
  const script = join(skills, 'build-mini-engine-game', 'scripts', 'play.mjs');
  const checked = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

test('MiniEngineUI kit pages keep the scaffold ids and its stylesheet only uses bundled fonts', async () => {
  const { gameFiles } = await import('../bin/templates.mjs');
  const ids = [...gameFiles('kit-check')['player.html'].matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
  assert.ok(ids.length > 5);
  const kit = join(skills, 'mini-engine-ui', 'kit');
  for (const page of ['host.html', 'player.html', 'display.html']) {
    const html = await readFile(join(kit, page), 'utf8');
    for (const id of ids) assert.ok(html.includes(` id="${id}"`), `${page} keeps #${id}`);
    assert.match(html, /href="\/games\/__SLUG__\/assets\/ui\/mini-engine-ui\.css"/);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/, `${page} has no inline script`);
  }
  const css = await readFile(join(kit, 'ui', 'mini-engine-ui.css'), 'utf8');
  const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]);
  assert.deepEqual(urls, ['fonts/space-grotesk.woff2', 'fonts/dm-sans.woff2']);
  for (const url of urls) await access(join(kit, 'ui', url));
});
