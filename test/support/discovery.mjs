// Copyright (C) 2026 Huawei Technologies Co., Ltd. Licensed under Apache-2.0.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../../', import.meta.url));
const ignored = new Set(['node_modules', 'dist', '.git', '.venv', '__pycache__', '.local', '.tmp', '.e2e', '.e2e-data', '.test-runs', '.worktrees', '.sciencediscovery-data']);
export function walk(directory, base = directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path, base) : [relative(base, path).replaceAll('\\', '/')];
  }).sort();
}
export const isTest = path => /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:test_.*|.*_test)\.py$)/.test(path);
export function discover(suite, directory = root) {
  const files = suite.files ?? walk(join(directory, suite.directory)).map(file => `${suite.directory}/${file}`).filter(file => isTest(file));
  const supported = file => {
    const local = suite.directory ? file.slice(suite.directory.length + 1) : file;
    if (suite.discovery === 'compiled-node') return /^src\/.*\.test\.ts$|^scripts\/.*\.test\.mjs$/.test(local);
    if (suite.discovery === 'web') return /^tests\/.*\.test\.tsx?$/.test(local);
    if (suite.discovery === 'source-node') return /\.test\.[cm]?js$/.test(local);
    return true;
  };
  return files.filter(file => supported(file) && !(suite.exclude ?? []).includes(file) && !(suite.excludeDirectories ?? []).some(dir => file.startsWith(dir + '/'))).sort();
}
export function nodeFiles(directory, mode = 'compiled') {
  if (mode === 'web') return walk(join(directory, 'tests')).filter(p => /\.test\.tsx?$/.test(p)).map(p => `tests/${p}`);
  if (mode === 'source') return walk(directory).filter(p => /\.test\.[cm]?js$/.test(p));
  const source = walk(join(directory, 'src')).filter(p => /\.test\.ts$/.test(p));
  const expected = source.map(p => `dist/${p.replace(/\.ts$/, '.js')}`);
  // walk intentionally ignores dist *children*, but traverses an explicitly selected dist root.
  const built = walk(join(directory, 'dist')).filter(p => /\.test\.js$/.test(p)).map(p => `dist/${p}`);
  const missing = expected.filter(p => !built.includes(p));
  const stale = built.filter(p => !expected.includes(p));
  if (missing.length || stale.length) throw new Error(`Build test mapping mismatch: missing=${missing.join(',')} stale=${stale.join(',')}; clean dist and rebuild`);
  return [...expected, ...walk(join(directory, 'scripts')).filter(p => /\.test\.mjs$/.test(p)).map(p => `scripts/${p}`)].sort();
}
export function inventoryProblems(suites, directory = root, exclusions = []) {
  const errors = [], owners = new Map(), ids = new Set();
  for (const suite of suites) {
    if (ids.has(suite.id)) errors.push(`Duplicate suite: ${suite.id}`);
    ids.add(suite.id);
    const files = discover(suite, directory);
    if (!files.length) errors.push(`Empty suite: ${suite.id}`);
    for (const file of files) {
      if (/(?:^|[^a-z])issue[-_ ]*\d/i.test(file.split('/').at(-1))) errors.push(`Issue-based test filename: ${file}; name the scenario and object instead`);
      if (/^(?:journey-|l[12]-)|-journey\./.test(file.split('/').at(-1))) errors.push(`Redundant test filename prefix/suffix: ${file}; name the object and behavior`);
      if (!existsSync(resolve(directory, file))) errors.push(`Missing asset: ${file}`);
      if (owners.has(file)) errors.push(`Duplicate ownership: ${file}: ${owners.get(file)}, ${suite.id}`);
      owners.set(file, suite.id);
    }
    for (const file of suite.exclude ?? []) if (!existsSync(resolve(directory, file))) errors.push(`Stale exclusion: ${file}`);
  }
  for (const exclusion of exclusions) {
    if (!exclusion.reason || !existsSync(join(directory, exclusion.file))) errors.push(`Stale/undocumented exclusion: ${exclusion.file}`);
    if (owners.has(exclusion.file)) errors.push(`Owned asset is also excluded: ${exclusion.file}`);
  }
  for (const file of walk(directory).filter(file => isTest(file) || /^test\/(?:st\/api\/.*\.mjs|st\/.*(?:.*\.(?:ts|sh)|.*-test\.py)|st\/contract\/cases\/.*\.json)$/.test(file))) if (!owners.has(file) && !exclusions.some(e => e.file === file)) errors.push(`Unowned test: ${file}`);
  return errors;
}
