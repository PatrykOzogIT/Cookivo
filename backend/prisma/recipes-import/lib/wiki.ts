/**
 * Pobieranie z Wikimedia: lista stron, treść (wikitekst) partiami, wyświetlenia (pageviews)
 * i metadane plików z Wikimedia Commons. Grzecznie: User-Agent z kontaktem, ponowienia z przerwą.
 */
import type { Wiki } from './types.js';

const UA = 'CookivoImport/1.0 (https://cookivo.pl; kontakt@cookivo.pl)';

export const WIKIS: Record<Wiki, { host: string; project: string; list: Record<string, string> }> = {
  pl: {
    host: 'pl.wikibooks.org',
    project: 'pl.wikibooks',
    list: { apnamespace: '0', apprefix: 'Książka kucharska/' },
  },
  en: { host: 'en.wikibooks.org', project: 'en.wikibooks', list: { apnamespace: '102' } },
};

/** Okres wyświetleń: 12 pełnych miesięcy przed importem */
export const VIEWS_FROM = '2025100100';
export const VIEWS_TO = '2026093000';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (attempt >= 8 || (res.status < 500 && res.status !== 429)) {
      throw new Error(`${res.status} ${url}`);
    }
    // Limit zapytań: czekamy tyle, ile prosi serwer (albo coraz dłużej)
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 3000 * attempt);
  }
}

async function api(host: string, params: Record<string, string>): Promise<Record<string, any>> {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  return ((await getJson(`https://${host}/w/api.php?${q}`)) ?? {}) as Record<string, any>;
}

export async function listPages(wiki: Wiki): Promise<{ pageId: number; title: string }[]> {
  const out: { pageId: number; title: string }[] = [];
  let cont: string | undefined;
  do {
    const j = await api(WIKIS[wiki].host, {
      action: 'query',
      list: 'allpages',
      aplimit: '500',
      apfilterredir: 'nonredirects',
      ...WIKIS[wiki].list,
      ...(cont ? { apcontinue: cont } : {}),
    });
    out.push(
      ...j.query.allpages.map((p: { pageid: number; title: string }) => ({
        pageId: p.pageid,
        title: p.title,
      })),
    );
    cont = j.continue?.apcontinue;
  } while (cont);
  return out;
}

export interface PageContent {
  pageId: number;
  title: string;
  revId: number;
  text: string;
}

/** Aktualna treść stron, po 50 w zapytaniu */
export async function fetchContents(wiki: Wiki, pageIds: number[]): Promise<PageContent[]> {
  const out: PageContent[] = [];
  for (let i = 0; i < pageIds.length; i += 50) {
    const j = await api(WIKIS[wiki].host, {
      action: 'query',
      prop: 'revisions',
      rvprop: 'ids|content',
      rvslots: 'main',
      pageids: pageIds.slice(i, i + 50).join('|'),
    });
    for (const p of j.query?.pages ?? []) {
      const rev = p.revisions?.[0];
      if (!rev) continue;
      out.push({ pageId: p.pageid, title: p.title, revId: rev.revid, text: rev.slots.main.content ?? '' });
    }
    await sleep(200);
  }
  return out;
}

/** Wyświetlenia strony przez ludzi (bez botów) w okresie VIEWS_FROM-VIEWS_TO */
export async function pageViews(wiki: Wiki, title: string): Promise<number> {
  const t = encodeURIComponent(title.replace(/ /g, '_'));
  const j = (await getJson(
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${WIKIS[wiki].project}/all-access/user/${t}/monthly/${VIEWS_FROM}/${VIEWS_TO}`,
  )) as { items?: { views: number }[] } | null;
  return (j?.items ?? []).reduce((s, x) => s + x.views, 0);
}

export interface CommonsFile {
  /** Nazwa pliku bez przedrostka "File:" */
  name: string;
  descriptionUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  mime: string;
  license: string;
  licenseUrl: string | null;
  author: string | null;
  /** Wymaga podania autora (CC BY / BY-SA) */
  attributionRequired: boolean;
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Metadane plików z Wikimedia Commons (null = pliku nie ma na Commons, np. lokalny plik
 * Wikibooks - takich nie bierzemy, bo mogą nie mieć wolnej licencji).
 */
export async function commonsFiles(names: string[]): Promise<Map<string, CommonsFile | null>> {
  const out = new Map<string, CommonsFile | null>();
  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i + 40);
    const j = await api('commons.wikimedia.org', {
      action: 'query',
      titles: chunk.map((n) => `File:${n}`).join('|'),
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1600',
    });
    const normalized = new Map<string, string>(
      (j.query?.normalized ?? []).map((n: { from: string; to: string }) => [n.to, n.from]),
    );
    for (const p of j.query?.pages ?? []) {
      const asked = (normalized.get(p.title) ?? p.title).replace(/^File:/, '');
      const ii = p.imageinfo?.[0];
      if (p.missing || !ii) {
        out.set(asked, null);
        continue;
      }
      const meta = ii.extmetadata ?? {};
      out.set(asked, {
        name: p.title.replace(/^File:/, ''),
        descriptionUrl: ii.descriptionurl,
        thumbUrl: ii.thumburl ?? ii.url,
        width: ii.width,
        height: ii.height,
        mime: ii.mime,
        license: stripHtml(meta.LicenseShortName?.value ?? ''),
        licenseUrl: meta.LicenseUrl?.value ?? null,
        author: meta.Artist?.value ? stripHtml(meta.Artist.value).slice(0, 300) : null,
        attributionRequired: meta.AttributionRequired?.value === 'true',
      });
    }
    for (const n of chunk) if (!out.has(n)) out.set(n, null);
    await sleep(200);
  }
  return out;
}

export async function download(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${url}`);
    await sleep(3000 * attempt);
  }
}

/** Wolne licencje zdjęć, które bierzemy (CC0, domena publiczna, CC BY, CC BY-SA) */
export function allowedPhotoLicense(license: string): boolean {
  return /^(cc0|cc[ -]by(-sa)?[ -]\d(\.\d)?|public domain|pd\b|pd-)/i.test(license.trim());
}
