// perf-bench-loader.mjs - Node ESM loader for tests/perf-benchmark.mjs.
//
// The game client is browser-first: modules import '/vendor/three.module.js'
// (absolute path, served by the game server) and use '?v=' cache-busting
// query strings, and the repo has no "type": "module" so .js defaults to CJS.
// This loader maps those to the local three install and forces ESM format
// for the client scripts, so the benchmark can import the REAL game code.
//
// Usage:
//   node --loader ./tests/perf-bench-loader.mjs tests/perf-benchmark.mjs
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = pathToFileURL(path.join(here, 'bench-vendor')).href + '/';
const threeModule = pathToFileURL(
  path.join(here, '..', 'node_modules', 'three', 'build', 'three.module.js')
).href;

function stripQuery(s) {
  const qi = s.indexOf('?');
  return qi >= 0 ? s.slice(0, qi) : s;
}

export async function resolve(specifier, context, next) {
  const s = stripQuery(specifier);
  const parent = context.parentURL || '';

  // 1. Absolute vendor imports -> local bench-vendor.
  if (s.startsWith('/vendor/')) {
    return { url: vendorDir + s.slice('/vendor/'.length), shortCircuit: true, format: 'module' };
  }
  // 2. Bare 'three' (used by three/addons internally) -> same module file.
  if (s === 'three') {
    return { url: threeModule, shortCircuit: true, format: 'module' };
  }
  // 3. Relative imports resolving into the client tree or bench-vendor -> ESM.
  if ((s.startsWith('./') || s.startsWith('../')) && s.endsWith('.js')) {
    const url = new URL(s, parent).href;
    if (url.includes('/client/js/') || url.includes('bench-vendor')) {
      return { url, shortCircuit: true, format: 'module' };
    }
  }
  return next(specifier, context);
}
