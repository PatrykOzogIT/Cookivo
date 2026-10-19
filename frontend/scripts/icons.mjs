// Ikony Material Symbols Rounded serwowane z naszego serwera (bez wysyłania IP odwiedzających do Google).
//
//   node scripts/icons.mjs          - zapisuje listę używanych ikon do src/app/core/icons.json
//   node scripts/icons.mjs --fetch  - dodatkowo pobiera font okrojony do tych ikon do public/fonts/
//   node scripts/icons.mjs --check  - błąd, gdy lista jest nieaktualna (npm run lint, CI)
//
// Listę zbieramy szeroko: każdy literał tekstowy w kodzie frontendu i w słownikach backendu,
// który jest nazwą ikony z pakietu `material-symbols`. Tryb --check (w `npm run lint`) pilnuje, żeby lista
// była aktualna - po dodaniu nowej ikony uruchom `npm run icons`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = [join(ROOT, 'src/app'), join(ROOT, '../backend/prisma/seed/reference-data.ts')];
const LIST = join(ROOT, 'src/app/core/icons.json');
const FONT = join(ROOT, 'public/fonts/material-symbols-rounded.woff2');
/**
 * Słowa, które w kodzie są kluczami/parametrami, a przypadkiem są też nazwami ikon
 * (np. 'groups' = slajd i filtr grup znajomych). Ikona użyta wprost w <span> lub icon: '...'
 * i tak trafi do fontu.
 */
const NOT_ICONS = new Set(['groups', 'problem', 'store']);

export function allIconNames() {
  const dts = readFileSync(join(ROOT, 'node_modules/material-symbols/index.d.ts'), 'utf8');
  return new Set([...dts.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));
}

function files(path) {
  if (path.endsWith('.ts') || path.endsWith('.html')) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(path, e.name))
      : // pomijamy testy i trasy (ścieżki typu 'groups' to nie ikony)
        /\.(ts|html)$/.test(e.name) && !/\.(spec|routes)\.ts$/.test(e.name)
        ? [join(path, e.name)]
        : [],
  );
}

export function usedIcons() {
  const known = allIconNames();
  const found = new Set();
  const unknown = new Set();
  for (const file of SOURCES.flatMap(files)) {
    const text = readFileSync(file, 'utf8');
    // Na pewno ikony: treść <span class="material-symbols-rounded">add</span> i pola icon: '...'.
    // Stare nazwy (np. restaurant_menu → fork_spoon) nie trafiają do okrojonego fontu - błąd.
    const sure = [
      ...text.matchAll(/material-symbols-rounded[^>]*>\s*([a-z][a-z0-9_]*)\s*</g),
      ...text.matchAll(/\bicon[A-Za-z]*:\s*'([a-z][a-z0-9_]*)'/g),
    ];
    for (const m of sure) {
      if (!known.has(m[1])) unknown.add(`${m[1]} (${file.slice(ROOT.length)})`);
      found.add(m[1]);
    }
    // Pozostałe literały w '...' / "..." i tekst między znacznikami - tylko znane nazwy ikon
    for (const m of text.matchAll(/['">]\s*([a-z][a-z0-9_]*)\s*['"<]/g)) {
      if (known.has(m[1]) && !NOT_ICONS.has(m[1])) found.add(m[1]);
    }
  }
  if (unknown.size) {
    console.error(
      `Nieznane nazwy ikon (użyj aktualnej nazwy z Material Symbols): ${[...unknown].join(', ')}`,
    );
    process.exit(1);
  }
  return [...found].sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const icons = usedIcons();
  if (process.argv.includes('--check')) {
    const saved = JSON.parse(readFileSync(LIST, 'utf8'));
    const missing = icons.filter((i) => !saved.includes(i));
    if (missing.length) {
      console.error(`Ikony spoza fontu: ${missing.join(', ')} - uruchom: npm run icons`);
      process.exit(1);
    }
    process.exit(0);
  }
  writeFileSync(LIST, JSON.stringify(icons, null, 2) + '\n');
  console.log(`ikon: ${icons.length} -> ${LIST}`);

  if (process.argv.includes('--fetch')) {
    // Google Fonts przycina font do podanych ikon (icon_names) - pobieramy raz i hostujemy u siebie
    const css = await fetch(
      'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..600,0..1,0' +
        `&icon_names=${icons.join(',')}&display=block`,
      // nowoczesny User-Agent = odpowiedź z woff2
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
        },
      },
    ).then((r) => r.text());
    const url = css.match(/url\((https:[^)]+)\)/)?.[1];
    if (!url) throw new Error('Brak adresu fontu w odpowiedzi:\n' + css);
    const font = Buffer.from(await (await fetch(url)).arrayBuffer());
    writeFileSync(FONT, font);
    console.log(`font: ${(font.length / 1024).toFixed(0)} KB -> ${FONT}`);
  }
}
