/*
 * Cechy produktu z angielskiej nazwy (obie bazy mają EN): produkt bazowy + stan, forma, zalewa,
 * zawartość tłuszczu, warianty. Klucz z cech służy do wykrywania duplikatów - podobna nazwa
 * przy różnych cechach to różne składniki (mleko 2% ≠ mleko 3,2%, tuńczyk w wodzie ≠ w oleju).
 */

export interface Features {
  base: string;
  /** Wszystkie rozpoznane cechy, posortowane */
  tags: string[];
  /** Słowa opisu po usunięciu szumu (do porównań i raportu) */
  detail: string[];
}

/** Fraza → cecha (kolejność ma znaczenie: dłuższe frazy najpierw) */
const TAG_PATTERNS: [RegExp, string][] = [
  [/\bcanned\b|\bin tins?\b|\bappertis/i, 'form:canned'],
  [/\bfrozen\b|\bsurgel/i, 'form:frozen'],
  [/\bpickled\b|\bfermented\b|\bsauerkraut\b|\bin vinegar\b/i, 'form:pickled'],
  [/\bdried\b|\bdehydrated\b|\bdry\b/i, 'form:dried'],
  [/\bsmoked\b/i, 'form:smoked'],
  [/\bsalted\b|\bin brine\b|\bcured\b/i, 'form:salted'],
  [/\bin (oil|olive oil|sunflower oil)\b|\boil[- ]packed\b/i, 'medium:oil'],
  [/\bin water\b|\bwater[- ]packed\b|\bin natural juice\b/i, 'medium:water'],
  [/\bin (heavy |light )?syrup\b/i, 'medium:syrup'],
  [/\bin tomato sauce\b/i, 'medium:tomato'],
  [/\braw\b|\bfresh\b|\buncooked\b/i, 'state:raw'],
  [/\bboiled\b|\bcooked in water\b|\bpoached\b|\bsimmered\b/i, 'state:boiled'],
  [/\bsteamed\b/i, 'state:steamed'],
  [/\broasted\b|\bbaked\b/i, 'state:roasted'],
  [/\bgrilled\b|\bbroiled\b/i, 'state:grilled'],
  [/\bfried\b|\bsaut[eé]ed\b|\bpan-fried\b/i, 'state:fried'],
  [/\bbraised\b|\bstewed\b/i, 'state:braised'],
  [/\bcooked\b/i, 'state:cooked'],
  [/\bunsweetened\b|\bno added sugar|\bwithout added sugar|\bsugar[- ]free\b/i, 'variant:nosugar'],
  [/\bsweetened\b|\bwith (added )?sugar/i, 'variant:sweet'],
  [/\bgluten[- ]free\b/i, 'variant:glutenfree'],
  [/\blactose[- ]free\b/i, 'variant:lactosefree'],
  [/\blight\b|\breduced fat\b|\blow fat\b|\blowfat\b/i, 'variant:light'],
  [/\bwhole ?grain\b|\bwholemeal\b|\bwhole wheat\b/i, 'variant:wholegrain'],
  [/\bskim(med)?\b|\bnonfat\b|\bfat[- ]free\b/i, 'fat:0'],
  [/\bsemi-skimmed\b/i, 'fat:semi'],
  [/\bwhole milk\b|\bwhole\b(?=.*\bmilk\b)/i, 'fat:whole'],
];

/** Szum w nazwach (klasy mięsa, opisy techniczne) - nie odróżnia składników w kuchni */
const NOISE =
  /\b(year round average|all grades|choice|select|prime|separable lean (and fat|only)|trimmed to [\d/]+"? fat|composite of (trimmed )?retail cuts|includes [^,]+|average|nfs|ns as to [^,]+|unenriched|enriched|with added [^,]+|without added [^,]+|prepacked|from supermarket|bulk|retail|commercial|regular pack|solids and liquids|drained solids|drained|ready-to-eat|ready to eat|rte|with(out)? (added )?salt|no (added )?salt( added)?|unsalted|salted|low sodium|reduced sodium|very low sodium|sodium[- ]free|lower sodium|reduced salt|low salt)\b/gi;

export function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|oes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/** "Milk, whole, 3.25% milkfat" → "3.25"; "Mleko 2%" → "2" (zawartość tłuszczu jako cecha) */
function fatPercent(name: string): string | null {
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? m[1].replace(',', '.') : null;
}

export function features(nameEn: string): Features {
  const tags = new Set<string>();
  for (const [re, tag] of TAG_PATTERNS) if (re.test(nameEn)) tags.add(tag);
  const fat = fatPercent(nameEn);
  if (fat) tags.add(`pct:${fat}`);
  // Stan: "gotowany" ogólnie znika, gdy jest dokładniejszy ("boiled", "roasted")
  if ([...tags].some((t) => t.startsWith('state:') && t !== 'state:cooked' && t !== 'state:raw'))
    tags.delete('state:cooked');

  const segments = nameEn
    .replace(NOISE, ' ')
    .split(/[,;()]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const base = (segments[0] ?? '').split(/\s+/).map(singular).join(' ');
  const detail = segments
    .slice(1)
    .flatMap((s) => s.split(/\s+/))
    .map(singular)
    .filter((w) => w.length > 2 && !/^\d/.test(w));
  return { base, tags: [...tags].sort(), detail };
}

/** Klucz duplikatu: produkt bazowy + cechy (bez szczegółów opisu) */
export function featureKey(f: Features): string {
  return [f.base, ...f.tags].join('|');
}
