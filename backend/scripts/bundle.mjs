/**
 * Paczka produkcyjna backendu na hosting bez SSH (CloudLinux "Setup Node.js App" + FTP).
 *
 *   npm run build && node scripts/bundle.mjs
 *
 * Wynik w deploy/:
 *   app.cjs              - plik startowy dla Passengera (ładuje moduł ES)
 *   package.json         - minimalny, bez zależności
 *   dist/main.mjs        - cały backend w jednym pliku (z dist/ po `nest build`, żeby zachować metadane dekoratorów)
 *   dist/node_modules/   - tylko moduły natywne (argon2, sharp) - instalowane dla Linuksa x64
 *
 * Katalog node_modules w głównym katalogu aplikacji należy do CloudLinux (symlink do jego środowiska),
 * dlatego moduły natywne leżą w dist/node_modules - Node znajdzie je, idąc w górę od dist/main.mjs.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'deploy');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Moduły natywne - nie do spakowania, instalowane osobno */
const NATIVE = ['argon2', 'sharp'];
/** Opcjonalne moduły Nesta, ładowane warunkowo - nie używamy ich */
const OPTIONAL = [
  '@nestjs/microservices',
  '@nestjs/microservices/microservices-module',
  '@nestjs/websockets',
  '@nestjs/websockets/socket-module',
  '@nestjs/platform-fastify',
  '@fastify/static',
  'class-transformer/storage',
];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });

await build({
  entryPoints: [join(root, 'dist/main.js')],
  outfile: join(out, 'dist/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...NATIVE, ...OPTIONAL],
  // Zależności CommonJS wołają require() - w module ES trzeba go odtworzyć
  banner: {
    js: "import { createRequire as __ckRequire } from 'node:module'; const require = __ckRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});

// Moduły natywne w wersjach z package.json, zawsze dla Linuksa x64 (serwer), niezależnie od systemu budującego
const natives = join(out, 'dist');
writeFileSync(
  join(natives, 'package.json'),
  JSON.stringify({
    private: true,
    dependencies: Object.fromEntries(NATIVE.map((n) => [n, pkg.dependencies[n]])),
  }),
);
execFileSync(
  'npm',
  ['install', '--omit=dev', '--no-audit', '--no-fund', '--os=linux', '--cpu=x64', '--libc=glibc'],
  { cwd: natives, stdio: 'inherit', shell: process.platform === 'win32' },
);
rmSync(join(natives, 'package.json'));
rmSync(join(natives, 'package-lock.json'), { force: true });

writeFileSync(
  join(out, 'app.cjs'),
  `// Plik startowy dla Passengera (CloudLinux "Setup Node.js App"). Backend jest modułem ES.
import('./dist/main.mjs').catch((err) => {
  console.error(err);
  process.exit(1);
});
`,
);
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify({ name: 'cookivo-api', version: pkg.version, private: true, main: 'app.cjs' }, null, 2) +
    '\n',
);
// Passenger restartuje aplikację, gdy zmieni się tmp/restart.txt - wgrywamy go przy każdym wdrożeniu
mkdirSync(join(out, 'tmp'), { recursive: true });
writeFileSync(join(out, 'tmp/restart.txt'), new Date().toISOString() + '\n');
console.log(`Paczka gotowa: ${out}`);
