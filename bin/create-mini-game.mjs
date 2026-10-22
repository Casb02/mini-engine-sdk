#!/usr/bin/env node
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { gameFiles } from './templates.mjs';

const usage = 'Usage: create-mini-game <slug> [--directory path]';
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(`${usage}\n\nCreates a trusted host-runtime vote game for your Mini Engine games directory.`);
} else {
  try {
    const slug = args[0];
    if (!slug || slug.length > 48 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error('Slug must be 1–48 lowercase letters, digits and single hyphens, starting with a letter.');
    }
    if (!(args.length === 1 || (args.length === 3 && args[1] === '--directory' && args[2] && !args[2].startsWith('--')))) {
      throw new Error(usage);
    }
    const directory = resolve(args[2] ?? slug);
    if (basename(directory) !== slug) {
      throw new Error(`The destination directory must be named ${slug} so Mini Engine can load its manifest.`);
    }
    await mkdir(dirname(directory), { recursive: true });
    // An exclusive directory creation preserves every existing destination, even an empty one.
    await mkdir(directory);
    try {
      for (const [name, content] of Object.entries(gameFiles(slug))) {
        await mkdir(dirname(join(directory, name)), { recursive: true });
        await writeFile(join(directory, name), content, { flag: 'wx' });
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    console.log(`Created ${slug} in ${directory}\n\nPlace this directory in your engine's games directory, restart the engine, and select it in /demo.\nRead ${join(directory, 'README.md')} to customize your game.`);
  } catch (error) {
    console.error(`create-mini-game: ${error.message}`);
    process.exitCode = 1;
  }
}
