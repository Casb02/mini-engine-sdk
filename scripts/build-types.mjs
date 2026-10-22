#!/usr/bin/env node
// Builds types/mini-engine.d.ts: one self-contained declaration file for the bundled dist/mini-engine.js.
// `--check` regenerates in memory and fails when the committed file differs, without writing anything.
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
export const typesPath = join(root, 'types', 'mini-engine.d.ts');
const entry = 'mini-engine';

function fail(message) {
  throw new Error(`build-types: ${message}`);
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  });
}

/** Type-check src/ and return the per-module declarations emitted by tsc, keyed by module name. */
function emitDeclarations() {
  const configPath = join(root, 'tsconfig.json');
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => fail(formatDiagnostics([diagnostic])),
  });
  if (config.errors.length) fail(formatDiagnostics(config.errors));
  const options = { ...config.options, declaration: true, emitDeclarationOnly: true, noEmit: false, declarationMap: false, sourceMap: false, newLine: ts.NewLineKind.LineFeed };
  const program = ts.createProgram({ rootNames: config.fileNames, options });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) fail(`TypeScript errors in src/:\n${formatDiagnostics(diagnostics)}`);
  const modules = new Map();
  const declarationDir = options.declarationDir ?? options.outDir ?? join(root, 'src');
  const result = program.emit(undefined, (fileName, text) => {
    if (!fileName.endsWith('.d.ts')) return;
    modules.set(relative(declarationDir, fileName).replace(/\\/g, '/').replace(/\.d\.ts$/, ''), text);
  });
  if (result.emitSkipped || result.diagnostics.length) fail(`declaration emit failed:\n${formatDiagnostics(result.diagnostics)}`);
  return modules;
}

const relativeSpecifier = /^\.\.?\//;
const moduleName = (from, specifier) => {
  const name = join(dirname(from), specifier).replace(/\\/g, '/').replace(/\.(?:js|ts|d\.ts)$/, '');
  return name.startsWith('./') ? name.slice(2) : name;
};

/** Inline every relative module reachable from the entry into one module declaration. */
export function stitch(modules, { header = '' } = {}) {
  const order = [];
  const visit = (name, trail) => {
    if (order.includes(name)) return;
    if (trail.includes(name)) fail(`circular declaration re-export: ${[...trail, name].join(' -> ')}`);
    const text = modules.get(name);
    if (text === undefined) fail(`no declarations emitted for ${name}`);
    for (const match of text.matchAll(/^export \* from ['"]([^'"]+)['"];$/gm)) {
      if (!relativeSpecifier.test(match[1])) fail(`${name}: re-export of external module ${match[1]} is not supported`);
      visit(moduleName(name, match[1]), [...trail, name]);
    }
    if (name !== entry) order.push(name);
  };
  visit(entry, []);
  // The entry may only re-export; anything else would be silently dropped.
  const entryRest = modules.get(entry).replace(/^export \* from ['"][^'"]+['"];$/gm, '').trim();
  if (entryRest && entryRest !== 'export {};') fail(`${entry}.d.ts may only contain "export * from" lines`);

  const seen = new Map();
  const sections = order.map(name => {
    const lines = [];
    for (const line of modules.get(name).split('\n')) {
      const imported = line.match(/^import (type )?\{([^}]*)\} from ['"]([^'"]+)['"];$/);
      if (imported) {
        if (!relativeSpecifier.test(imported[3])) fail(`${name}: import from external module ${imported[3]} is not supported`);
        if (/\bas\b/.test(imported[2])) fail(`${name}: aliased imports cannot be flattened`);
        if (!order.includes(moduleName(name, imported[3]))) fail(`${name}: imports ${imported[3]}, which the entry does not re-export`);
        continue;
      }
      if (/^import\s/.test(line)) fail(`${name}: unsupported import form: ${line}`);
      if (/^export (?:\*|\{[^}]*\}) from/.test(line)) fail(`${name}: nested re-exports are not supported: ${line}`);
      if (line === 'export {};') continue;
      const declared = line.match(/^(?:export )?(?:declare )?(?:abstract )?(?:interface|type|class|function|const|let|var|enum|namespace) ([A-Za-z_$][\w$]*)/);
      if (declared) {
        const owner = seen.get(declared[1]);
        // Overloaded functions repeat their name in one module; anything else would merge or clash.
        if (owner && owner !== name) fail(`${declared[1]} is declared in both ${owner} and ${name}`);
        seen.set(declared[1], name);
      }
      lines.push(line);
    }
    return `// ---- src/${name}.ts ----\n${lines.join('\n').trim()}\n`;
  });
  const bundle = `${header}${sections.join('\n')}\n// Only declarations marked "export" above are part of the public API.\nexport {};\n`;
  if (/from ['"]\.\.?\/|import\(['"]\.\.?\//.test(bundle)) fail('the bundle still contains a relative module reference');
  return bundle;
}

/** Compile the bundle on its own, without skipLibCheck, so it cannot depend on a missing file. */
async function verifyStandalone(bundle) {
  const directory = await mkdtemp(join(tmpdir(), 'mini-engine-types-'));
  try {
    const file = join(directory, 'mini-engine.d.ts');
    await writeFile(file, bundle);
    const program = ts.createProgram({
      rootNames: [file],
      options: { strict: true, noEmit: true, skipLibCheck: false, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [] },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) fail(`the bundled declaration does not compile on its own:\n${formatDiagnostics(diagnostics)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function buildTypes({ check = false } = {}) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const header = `// Type declarations for ${pkg.name} ${pkg.version} (dist/mini-engine.js, served by Mini Engine at /sdk/mini-engine.js).\n`
    + '// Generated by scripts/build-types.mjs from src/. Do not edit by hand: run `npm run build`.\n\n';
  const bundle = stitch(emitDeclarations(), { header });
  await verifyStandalone(bundle);
  if (check) {
    const committed = await readFile(typesPath, 'utf8').then(text => text.replace(/\r\n/g, '\n'), error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (committed !== bundle) fail('types/mini-engine.d.ts is stale or missing. Run `npm run build` and commit the result.');
    return { path: typesPath, changed: false };
  }
  await mkdir(dirname(typesPath), { recursive: true });
  await writeFile(typesPath, bundle);
  return { path: typesPath, changed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  try {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('Usage: node scripts/build-types.mjs [--check]');
    const check = args[0] === '--check';
    await buildTypes({ check });
    console.log(`${check ? 'Verified' : 'Wrote'} ${relative(root, typesPath)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
