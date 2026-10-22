/** Wikitekst → czysty tekst dla modelu, zdjęcia, kategorie i prosta kontrola kompletności (bez AI) */
import { normalizeSearch } from '../../../src/common/text.js';

const INGREDIENTS = /^(składniki|skladniki|ingredients?)\b/i;
const STEPS =
  /^(przygotowanie|wykonanie|sposób przygotowania|sposob przygotowania|sposób wykonania|procedure|preparation|method|directions|instructions)\b/i;
/** Linia składnika z ilością: liczba, ułamek albo miara słowna */
const QUANTITY =
  /\d|½|¼|¾|⅓|⅔|⅛|szczypt|pinch|łyżk|lyzk|tbsp|tsp|teaspoon|tablespoon|cup|szklan|garś|handful|\bpół\b|\bhalf\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bjed(en|na|no)\b|\bdw(a|ie)\b|\btrzy\b|\bcztery\b|\bpięć\b|ząb|clove|\ba (dash|few|little|small|medium|large)\b/i;

export type Completeness = 'OK' | 'NO_INGREDIENTS' | 'NO_AMOUNTS' | 'NO_STEPS';

interface Section {
  heading: string;
  lines: string[];
}

function sections(text: string): Section[] {
  const out: Section[] = [{ heading: '', lines: [] }];
  for (const line of text.split('\n')) {
    const h = /^\s*(={2,6})\s*(.+?)\s*\1\s*$/.exec(line);
    if (h) out.push({ heading: h[2].replace(/'{2,}/g, '').trim(), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

/**
 * Prosta kontrola (przed AI, za darmo): sekcja składników z co najmniej 2 pozycjami,
 * w której ≥ 70% pozycji ma ilość, oraz sekcja przygotowania.
 */
export function judge(wikitext: string): Completeness {
  const all = sections(wikitext);
  const lists = all
    .filter((s) => INGREDIENTS.test(s.heading))
    .map((s) => s.lines.filter((l) => /^\s*[*#]/.test(l)));
  const best = lists.filter((l) => l.length >= 2);
  if (!best.length) return 'NO_INGREDIENTS';
  if (!all.some((s) => STEPS.test(s.heading))) return 'NO_STEPS';
  const ok = best.some((items) => items.filter((l) => QUANTITY.test(l)).length / items.length >= 0.7);
  return ok ? 'OK' : 'NO_AMOUNTS';
}

export interface CleanPage {
  text: string;
  /** Pliki zdjęć w kolejności ważności (szablon strony, potem pierwsze w treści, potem galeria) */
  images: string[];
  categories: string[];
}

const FILE_PREFIX = /^(file|image|plik|grafika)\s*:/i;
const CATEGORY = /^\[\[\s*(category|kategoria)\s*:\s*([^|\]]+)[^\]]*\]\]/i;

/** Usuwa [[...]] z zagnieżdżeniami (podpis zdjęcia z linkami), zwraca listę i tekst */
function extractBracketed(text: string, keep: (inner: string) => string | null): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('[[', i)) {
      let depth = 0;
      let j = i;
      for (; j < text.length - 1; j++) {
        if (text.startsWith('[[', j)) {
          depth++;
          j++;
        } else if (text.startsWith(']]', j)) {
          depth--;
          j++;
          if (depth === 0) break;
        }
      }
      const inner = text.slice(i + 2, j - 1);
      const replaced = keep(inner);
      out += replaced ?? text.slice(i, j + 1);
      i = j + 1;
    } else {
      out += text[i++];
    }
  }
  return out;
}

function splitParams(body: string): { name: string; positional: string[]; named: Record<string, string> } {
  const [name, ...parts] = body.split('|');
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const p of parts) {
    const m = /^\s*([\w ]+?)\s*=(.*)$/s.exec(p);
    if (m) named[m[1].trim().toLowerCase()] = m[2].trim();
    else positional.push(p.trim());
  }
  return { name: name.trim().toLowerCase(), positional, named };
}

export function cleanWikitext(wikitext: string): CleanPage {
  const images: string[] = [];
  const pageImages: string[] = [];
  const galleryImages: string[] = [];
  const categories: string[] = [];
  let t = wikitext
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<gallery[^>]*>([\s\S]*?)<\/gallery>/gi, (_, body: string) => {
      for (const line of body.split('\n')) {
        const m = /^\s*(?:(?:file|image|plik|grafika)\s*:)?([^|]+\.(?:jpe?g|png|webp|gif|tiff?))/i.exec(line);
        if (m) galleryImages.push(m[1].trim());
      }
      return '';
    })
    .replace(/<categorytree[\s\S]*?<\/categorytree>/gi, '');

  // Pliki i kategorie (zagnieżdżone nawiasy w podpisach), potem zwykłe linki
  t = extractBracketed(t, (inner) => {
    if (FILE_PREFIX.test(inner)) {
      images.push(inner.replace(FILE_PREFIX, '').split('|')[0].trim());
      return '';
    }
    const cat = CATEGORY.exec(`[[${inner}]]`);
    if (cat) {
      categories.push(cat[2].trim());
      return '';
    }
    return null;
  });
  t = t
    .replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, (_, a: string) =>
      a.replace(/^(cookbook|książka kucharska)\s*:\s*/i, '').replace(/^książka kucharska\//i, ''),
    );
  t = t.replace(/\[(https?:\/\/\S+)\s+([^\]]+)\]/g, '$2').replace(/\[(https?:\/\/\S+)\]/g, '');

  // Szablony od najbardziej wewnętrznych
  for (let guard = 0; guard < 20 && /\{\{[^{}]*\}\}/.test(t); guard++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      const { name, positional, named } = splitParams(body);
      if (name === 'frac')
        return positional.length >= 3
          ? `${positional[0]} ${positional[1]}/${positional[2]}`
          : positional.join('/');
      if (name === 'c' || name === '°c') return `${positional[0]} °C`;
      if (name === 'f' || name === '°f') return `${positional[0]} °F`;
      if (name === 'convert' || name === 'cvt') return `${positional[0]} ${positional[1] ?? ''}`.trim();
      if (name === 'plik' || name === 'file') {
        const file = named.plik ?? named.file ?? positional[0];
        if (file) pageImages.push(file.replace(FILE_PREFIX, '').trim());
        return '';
      }
      if (/recipe|przepis|summary/.test(name)) {
        const img = named.image ?? named.zdjęcie ?? named.grafika;
        if (img) pageImages.push(img.replace(FILE_PREFIX, '').trim());
        return Object.entries(named)
          .filter(([k, v]) => v && !/image|zdj|grafika/.test(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
      }
      return '';
    });
  }

  t = t
    .replace(/'{2,}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => {
      if (/^\s*(\{\||\|\}|\|-)/.test(l)) return '';
      if (/^\s*[|!]/.test(l))
        return l
          .replace(/^\s*[|!]/, '')
          .split(/\|\||!!/)
          .join(' | ');
      return l.replace(/\s+$/, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const seen = new Set<string>();
  const ordered = [...pageImages, ...images, ...galleryImages]
    .map((f) => f.replace(/_/g, ' ').trim())
    .filter(
      (f) => /\.(jpe?g|png|webp|tiff?)$/i.test(f) && !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase()),
    );
  return { text: t.slice(0, 15000), images: ordered, categories };
}

/** Pliki, które nie są zdjęciem potrawy (obrazy, mapy, ikony) */
const NOT_DISH =
  /google art project|painting|obraz|portrait|portret|\bmapa?\b|logo|icon|ikona|flag|herb|diagram|chart|wykres/i;
/** Zdjęcia etapów przygotowania - gorsze niż zdjęcie gotowej potrawy */
const PROCESS =
  /beating|mixing|mixture|dough|batter|ingredients|dirty|checking|in tin|składniki|ciasto przed|przygotowanie/i;

/**
 * Kolejność zdjęć do wyboru: bez obrazów i map; najpierw te z nazwą pasującą do tytułu,
 * potem zdjęcia gotowej potrawy przed zdjęciami etapów; dalej kolejność ze strony.
 */
export function rankImages(images: string[], title: string): string[] {
  const words = normalizeSearch(title.replace(/^(cookbook:|książka kucharska\/)/i, ''))
    .split(' ')
    .filter((w) => w.length >= 4);
  const matches = (file: string) =>
    normalizeSearch(file.replace(/\.\w+$/, ''))
      .split(' ')
      .some(
        (w) => w.length >= 4 && words.some((t) => w.startsWith(t.slice(0, 5)) || t.startsWith(w.slice(0, 5))),
      );
  return images
    .filter((f) => !NOT_DISH.test(f))
    .map((f, i) => ({ f, i, m: matches(f) ? 0 : 1, p: PROCESS.test(f) ? 1 : 0 }))
    .sort((a, b) => a.m - b.m || a.p - b.p || a.i - b.i)
    .map((x) => x.f);
}
