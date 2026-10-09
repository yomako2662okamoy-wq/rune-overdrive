import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert(scripts.length > 0, 'ゲームのスクリプトが見つからない');
for (const [i, match] of scripts.entries()) new vm.Script(match[1], { filename: 'index.html#' + i });
for (const name of readdirSync(resolve(root, 'tools')).filter((name) => name.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, 'tools', name)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || name);
}
console.log('PASS: index.html と tools/*.mjs の構文');
