// Shared rules check. Runs from the app root, no dependencies. Source: it-operations-forge-template.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const EM_DASH = String.fromCharCode(0x2014);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.gz', '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.mp4']);
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/;

const problems = [];
const fail = (path, line, message) => problems.push(`${path}:${line}: ${message}`);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
const staticDirs = () => (existsSync('static') ? readdirSync('static').filter((d) => statSync(join('static', d)).isDirectory()) : []);

function bundleCheck() {
  let max = 500;
  if (existsSync('package.json')) max = JSON.parse(readFileSync('package.json', 'utf8')).config?.maxBundleKb ?? 500;
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [statSync(p).size] : [];
    });
  for (const d of staticDirs()) {
    const build = join('static', d, 'build');
    if (!existsSync(build)) {
      fail(build, 1, 'build folder is missing: run npm run build first');
      continue;
    }
    const kb = walk(build).reduce((a, b) => a + b, 0) / 1024;
    console.log(`Bundle ${build}: ${kb.toFixed(1)} KB of ${max} KB`);
    if (kb > max) fail(build, 1, `JS bundle is ${kb.toFixed(1)} KB, limit is ${max} KB (config.maxBundleKb)`);
  }
}

function sourceCheck() {
  const files = [...new Set(git('ls-files', '-co', '--exclude-standard'))].filter((f) => existsSync(f) && !BINARY.has(extname(f).toLowerCase()));

  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    const isCss = /^static\/[^/]+\/src\/.*\.css$/.test(f);
    lines.forEach((line, i) => {
      if (line.includes(EM_DASH)) fail(f, i + 1, 'em dash is not allowed');
      if (isCss && COLOR.test(line) && !line.includes('var(--ds-')) fail(f, i + 1, 'color literal outside a var(--ds-...) fallback');
    });
    if (f === 'manifest.yml' || (f.startsWith('.env') && f !== '.env.example')) fail(f, 1, 'must not be tracked or left unignored');
  }

  if (!existsSync('manifest.yml.example')) fail('manifest.yml.example', 1, 'file is missing');
  else {
    const text = readFileSync('manifest.yml.example', 'utf8');
    if (!text.includes('REPLACE_ME')) fail('manifest.yml.example', 1, 'must contain REPLACE_ME');
    text.split('\n').forEach((line, i) => {
      if (/^\s*external\s*:/.test(line)) fail('manifest.yml.example', i + 1, 'external: is not allowed (no external egress)');
    });
  }

  for (const d of staticDirs()) {
    const f = join('static', d, 'index.html');
    if (!existsSync(f)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    if (!/<meta[^>]+name=["']viewport["']/i.test(lines.join('\n'))) fail(f, 1, 'viewport meta tag is missing');
    lines.forEach((line, i) => {
      if (/\b(?:src|href)\s*=\s*["'](?:https?:|\/\/)/i.test(line)) fail(f, i + 1, 'remote src or href is not allowed');
    });
  }
}

if (process.argv.includes('--bundle')) bundleCheck();
else sourceCheck();

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(process.argv.includes('--bundle') ? 'OK: bundle size' : 'OK: shared rules');
