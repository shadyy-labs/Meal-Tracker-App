/**
 * Arabic-aware nutrition-plan extraction.
 *
 * Pipeline: PDF.js items → reconstructPdfLines (rows by y, words by x-gaps)
 *   → repairArabicVisualOrder (visual → logical order, Presentation Forms → base letters)
 *   → parseMealSections (meal headings, foods + grams, البدائل grouping) → plan draft.
 *
 * Everything except loadPdfJs/extractPdf is pure so it can be unit tested in Node.
 */
export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const MEAL_TYPES = ['breakfast', 'snack', 'lunch', 'dinner', 'supplements'];

// ---------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------
const ARABIC_RE = /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]/;
const PRESENTATION_RE = /[\ufb50-\ufdff\ufe70-\ufeff]/;
const ARABIC_LETTER_RE = /[\u0621-\u064a\u0671-\u06d3]/;
// Letters that only connect to the letter before them (never to the next one).
const RIGHT_JOINING = new Set([...'اأإآٱدذرزوؤةى', 'ء']);
const ALEFS = new Set([...'اأإآٱ']);
// Letters after which a word always ends, whatever their shape.
const WORD_FINAL = new Set([...'ةىء']);

export const hasArabic = (s) => ARABIC_RE.test(s);
export const hasPresentationForms = (s) => PRESENTATION_RE.test(s);

// Arabic Presentation Forms-B: each letter is listed with its glyph forms in the
// order isolated, final, initial, medial. Built once so a glyph's base letter and
// contextual shape can be read back — the shape tells us where words connect.
const FORMS_B = (() => {
  const letters = [
    ['ء', 1],
    ['آ', 2],
    ['أ', 2],
    ['ؤ', 2],
    ['إ', 2],
    ['ئ', 4],
    ['ا', 2],
    ['ب', 4],
    ['ة', 2],
    ['ت', 4],
    ['ث', 4],
    ['ج', 4],
    ['ح', 4],
    ['خ', 4],
    ['د', 2],
    ['ذ', 2],
    ['ر', 2],
    ['ز', 2],
    ['س', 4],
    ['ش', 4],
    ['ص', 4],
    ['ض', 4],
    ['ط', 4],
    ['ظ', 4],
    ['ع', 4],
    ['غ', 4],
    ['ف', 4],
    ['ق', 4],
    ['ك', 4],
    ['ل', 4],
    ['م', 4],
    ['ن', 4],
    ['ه', 4],
    ['و', 2],
    ['ى', 2],
    ['ي', 4],
  ];
  const shapes = ['isol', 'fin', 'init', 'med'];
  const map = new Map();
  let code = 0xfe80;
  for (const [base, count] of letters)
    for (let i = 0; i < count; i++) map.set(code++, { base, form: shapes[i] });
  // Lam-alef ligatures (isolated, final) — base text is "لا" variants.
  for (const base of ['لآ', 'لأ', 'لإ', 'لا'])
    for (let i = 0; i < 2; i++) map.set(code++, { base, form: shapes[i] });
  return map;
})();

/** First/last letter info of a token: base letter plus glyph shape ('base' when unknown). */
function edgeInfo(token, last) {
  const chars = [...token].filter((c) => ARABIC_RE.test(c));
  if (!chars.length) return null;
  const c = last ? chars[chars.length - 1] : chars[0];
  const info = FORMS_B.get(c.codePointAt(0));
  if (info) {
    const base = last ? info.base.slice(-1) : info.base[0];
    // A lam-alef ligature connects backwards through its lam; its alef never connects forward.
    if (info.base.length > 1)
      return { base, form: last ? 'fin' : info.form === 'fin' ? 'fin' : 'isol' };
    return info;
  }
  const base = c.normalize('NFKC');
  return { base: last ? base.slice(-1) : base[0], form: 'base' };
}

// ---------------------------------------------------------------------------
// A. Unicode normalization
// ---------------------------------------------------------------------------
export function normalizeDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

/** Display-safe normalization: Presentation Forms → base letters, digits, controls, spacing. */
export function normalizeArabicText(s) {
  return normalizeDigits(
    String(s ?? '')
      .replace(/﴾/g, ')')
      .replace(/﴿/g, '(')
      .normalize('NFKC'),
  )
    .replace(/[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]/g, '') // direction marks
    .replace(/[\u064b-\u065f\u0670]/g, '') // tashkeel
    .replace(/ـ/g, '') // tatweel
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+([،,.:؛])/g, '$1')
    .replace(/(\d)\s*%\s*-\s*(\d+)\s*%/g, '$1%-$2%')
    .trim();
}

/** Matching-only form: folds letter variants so ه/ة, ى/ي and hamza-alefs compare equal. */
export function canonicalArabic(s) {
  return normalizeArabicText(s)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// B. Visual → logical order repair
// ---------------------------------------------------------------------------
const MIRROR = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
};
const BRIDGE_RE = /^[.,:/]+$/; // neutrals kept inside a left-to-right run (9.07, 1/2)
const tokenKind = (t) =>
  hasArabic(t) ? 'rtl' : /[A-Za-z0-9\u0660-\u0669\u06f0-\u06f9]/.test(t) ? 'ltr' : 'neutral';

// Short words used only to choose between the two possible orders of an ambiguous
// two-letter fragment (see orientToken). The general rules handle everything else.
const LEXICON = new Set(
  [
    'جرام',
    'غرام',
    'جم',
    'سريع',
    'غير',
    'بني',
    'بنى',
    'لبن',
    'بسمتي',
    'بودر',
    'مرتين',
    'مرتان',
    'مباشره',
    'مباشرة',
    'الصدور',
    'الموجوده',
    'الغداء',
    'واي',
    'سكوب',
    'السعرات',
    'الكربوهيدرات',
    'الفيتامينات',
    'البروتين',
    'الدهون',
    'البدائل',
    'بدائل',
    'مملح',
    'ملح',
    'خس',
    'موز',
    'لوز',
    'تمر',
    'بلح',
    'رز',
    'أرز',
    // Common words that end in a right-joining letter (ا د ذ ر ز و), where a word
    // break can't be read from glyph shapes alone.
    'تمرين',
    'بعد',
    'عند',
    'احمر',
    'اخضر',
    'اصفر',
    'شيدر',
    'جزر',
    'بطاطا',
    'صدر',
    'بذور',
    'دهون',
    'بدون',
    'سكر',
    'خضار',
    'خيار',
    'زبادي',
    'كاكاو',
    'جدا',
    'قدر',
    'وزن',
    'فطار',
    'افطار',
    'عشاء',
    'غداء',
    'بيض',
    'دجاج',
    'لحم',
    'سمك',
    'تونه',
    'جبنه',
    'خبز',
    'فول',
    'عدس',
    'شوفان',
    'حليب',
    'عسل',
    'زيت',
    'زيتون',
    'تورتيلا',
    'مكرونه',
    'فراوله',
    'تفاح',
    'برتقال',
    'مشوي',
    'مسلوق',
    'مطهي',
    'كامل',
    'خالي',
    'خاليه',
  ].map((w) => canonicalArabic(w)),
);
const inLexicon = (word) => {
  const c = canonicalArabic(word);
  return LEXICON.has(c) || LEXICON.has(c.replace(/^(?:ال|و|ب)/, ''));
};

/**
 * Orientation of one extracted Arabic fragment. Single glyphs are trivially fine;
 * multi-glyph Presentation-Form runs are in visual order; short runs of base letters
 * come either way, so default by their first letter and let the lexicon override.
 */
function orientToken(token) {
  const letters = [...token];
  if (letters.length < 2 || !hasArabic(token))
    return { text: token, reversed: true, ambiguous: false };
  if (hasPresentationForms(token))
    return { text: letters.reverse().join(''), reversed: true, ambiguous: false };
  if (letters.length > 3) return { text: token, reversed: false, ambiguous: false }; // PDF.js already reordered
  const keep = ALEFS.has(letters[0]) || 'دذوء'.includes(letters[0]);
  const flipped = [...letters].reverse().join('');
  return {
    text: keep ? token : flipped,
    alt: keep ? flipped : token,
    reversed: !keep,
    ambiguous: true,
  };
}

/**
 * Boundary between two adjacent Arabic fragments (logical order): 'join', 'split', or
 * 'maybe'. Glyph shapes decide exactly except after right-joining letters (ا د ذ ر ز و),
 * which never connect forward, so a break after them is invisible in the shapes.
 */
function boundary(prevToken, nextToken) {
  const a = edgeInfo(prevToken, true),
    b = edgeInfo(nextToken, false);
  if (!a || !b || !ARABIC_LETTER_RE.test(a.base) || !ARABIC_LETTER_RE.test(b.base)) return 'split';
  if (a.form === 'init' || a.form === 'med') return 'join';
  if (b.form === 'fin' || b.form === 'med') return 'join';
  if (WORD_FINAL.has(a.base)) return 'split';
  if (!RIGHT_JOINING.has(a.base)) return 'split'; // a dual-joining letter that did not connect ends the word
  return 'maybe';
}

/**
 * Rebuild logical text from tokens in visual (left-to-right) order.
 * tokens: [{ text, gapBefore }] where gapBefore is true/false from PDF geometry,
 * or null when unknown (plain text) — then glyph shapes decide word boundaries.
 * Lines without Presentation Forms are treated as already logical and only normalized.
 */
export function repairArabicVisualOrder(input, { force = false } = {}) {
  const tokens = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((text) => ({ text, gapBefore: null }));
  const joined = tokens.map((t) => t.text).join(' ');
  if (!force && !hasPresentationForms(joined))
    return { text: normalizeArabicText(joined), repaired: false, confident: true };

  // Group into units: runs of left-to-right tokens stay in reading order.
  const units = [];
  tokens.forEach((tok, i) => {
    const kind = tokenKind(tok.text);
    const prev = units[units.length - 1];
    const nextKind = tokens[i + 1] ? tokenKind(tokens[i + 1].text) : null;
    const bridges =
      kind === 'neutral' && BRIDGE_RE.test(tok.text) && prev?.kind === 'ltr' && nextKind === 'ltr';
    if (prev?.kind === 'ltr' && (kind === 'ltr' || bridges)) prev.tokens.push(tok);
    else units.push({ kind: bridges ? 'ltr' : kind, tokens: [tok] });
  });
  // Paragraph direction is RTL: reverse unit order; mirror neutral brackets.
  const logical = [];
  for (let u = units.length - 1; u >= 0; u--) {
    const unit = units[u];
    if (unit.kind === 'ltr') {
      logical.push({
        kind: 'ltr',
        text: unit.tokens.map((t, i) => (i && t.gapBefore !== false ? ' ' : '') + t.text).join(''),
        gapAfter: unit.tokens[0].gapBefore,
      });
      continue;
    }
    const tok = unit.tokens[0];
    if (unit.kind === 'neutral') {
      logical.push({
        kind: 'neutral',
        text: [...tok.text]
          .reverse()
          .map((c) => MIRROR[c] || c)
          .join(''),
        gapAfter: tok.gapBefore,
      });
      continue;
    }
    // Arabic fragment, possibly with trailing/leading punctuation glued to it.
    const m = tok.text.match(/^([^\p{L}]*)([\s\S]*?)([^\p{L}]*)$/u);
    const oriented =
      tok.visual === true
        ? { text: [...m[2]].reverse().join(''), reversed: true, ambiguous: false }
        : orientToken(m[2]);
    // Punctuation glued to a visual-order fragment sits on the opposite side logically.
    const [pre, post] = oriented.reversed ? [m[3], m[1]] : [m[1], m[3]];
    logical.push({
      kind: 'rtl',
      text: oriented.text,
      alt: oriented.alt,
      ambiguous: oriented.ambiguous,
      pre,
      post,
      gapAfter: tok.gapBefore,
    });
  }
  // gapAfter on logical[i] describes the gap between logical[i] and logical[i + 1].
  let confident = true;
  const links = logical.map((piece, i) => {
    const prev = logical[i - 1];
    if (!prev || piece.kind !== 'rtl' || prev.kind !== 'rtl' || prev.post || piece.pre)
      return 'split';
    if (prev.gapAfter === false) return 'join';
    if (prev.gapAfter === true) return 'split';
    return boundary(prev.text, piece.text);
  });
  // Resolve 'maybe' links: join when the longer word is known, split when the word so
  // far is a known word on its own, otherwise join (breaks are rarer than continuations).
  const words = [];
  let current = null;
  logical.forEach((piece, i) => {
    let glue = links[i] === 'join';
    if (links[i] === 'maybe') {
      const left = current.parts.map((p) => p.text).join('');
      let right = '';
      for (let j = i; j < logical.length && (j === i || links[j] !== 'split'); j++)
        right += logical[j].text;
      if (inLexicon(left + right)) glue = true;
      else if (inLexicon(left) && left.length > 2) glue = false;
      else {
        glue = true;
        confident = false;
      }
    }
    if (glue) current.parts.push(piece);
    else {
      current = { parts: [piece] };
      words.push(current);
    }
  });
  const out = words.map(({ parts }) => {
    const ambiguous = parts.filter((p) => p.ambiguous);
    if (ambiguous.length) {
      const build = () => parts.map((p) => p.text).join('');
      const base = build();
      if (!inLexicon(base)) {
        // Try the other order of each ambiguous fragment; accept only a lexicon hit.
        for (let mask = 1; mask < 1 << Math.min(ambiguous.length, 3); mask++) {
          const flipped = parts.map((p) => {
            const idx = ambiguous.indexOf(p);
            return idx >= 0 && idx < 3 && mask & (1 << idx) ? p.alt : p.text;
          });
          if (inLexicon(flipped.join(''))) {
            ambiguous.forEach((p, idx) => {
              if (idx < 3 && mask & (1 << idx)) p.text = p.alt;
            });
            break;
          }
        }
      }
    }
    if (parts.some((p) => p.ambiguous) && !inLexicon(parts.map((p) => p.text).join('')))
      confident = confident && parts.length > 2;
    const first = parts[0],
      last = parts[parts.length - 1];
    return (first.pre || '') + parts.map((p) => p.text).join('') + (last.post || '');
  });
  return { text: normalizeArabicText(out.join(' ')), repaired: true, confident };
}

// ---------------------------------------------------------------------------
// C. PDF.js line reconstruction
// ---------------------------------------------------------------------------
const UNKNOWN_GLYPH = '\ufffd';
// (base letter, shape) → Presentation Forms-B glyph, the inverse of FORMS_B.
const PRES_OF = new Map();
for (const [code, { base, form }] of FORMS_B)
  if (base.length === 1) PRES_OF.set(`${base}|${form}`, String.fromCodePoint(code));
const isDualJoining = (c) => ARABIC_LETTER_RE.test(c) && !RIGHT_JOINING.has(c);
const itemSize = (item) => {
  const t = item.transform || [1, 0, 0, 1, 0, 0];
  return Math.hypot(t[2], t[3]) || item.height || 10;
};

/** Unmapped glyphs (no ToUnicode entry) become U+FFFD; "۔" between digits is a decimal point. */
function cleanItemString(str) {
  return str.replace(/\u0000/g, UNKNOWN_GLYPH).replace(/\u06d4/g, '.');
}

/** Median advance width (as a fraction of font size) of every single glyph in the document, per font. */
export function buildGlyphWidths(items) {
  const samples = new Map();
  for (const item of items || []) {
    const str = cleanItemString(item.str ?? '');
    const size = itemSize(item);
    if ([...str].length !== 1 || !(item.width > 0)) continue;
    for (const key of [`${item.fontName}|${str}`, `*|${str}`]) {
      if (!samples.has(key)) samples.set(key, []);
      samples.get(key).push(item.width / size);
    }
  }
  const table = new Map();
  for (const [key, list] of samples) table.set(key, list.sort((a, b) => a - b)[list.length >> 1]);
  return table;
}

/** Width the text would occupy if `logical` were shaped (joined letters take contextual glyphs). */
function shapedWidth(logical, font, size, widths) {
  const chars = [...logical];
  let total = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    let candidates = [c];
    if (ARABIC_LETTER_RE.test(c)) {
      const joinPrev = i > 0 && isDualJoining(chars[i - 1]);
      const joinNext =
        i < chars.length - 1 && ARABIC_LETTER_RE.test(chars[i + 1]) && isDualJoining(c);
      const form = joinPrev && joinNext ? 'med' : joinPrev ? 'fin' : joinNext ? 'init' : 'isol';
      const pres = PRES_OF.get(`${c}|${form}`);
      candidates = form === 'isol' ? [c, pres] : [pres];
    }
    const w = candidates
      .filter(Boolean)
      .map((g) => widths.get(`${font}|${g}`) ?? widths.get(`*|${g}`))
      .find((v) => v != null);
    if (w == null) return null;
    total += w * size;
  }
  return total;
}
const hasJoins = (logical) => {
  const chars = [...logical];
  return chars.some(
    (c, i) => i < chars.length - 1 && ARABIC_LETTER_RE.test(chars[i + 1]) && isDualJoining(c),
  );
};

/**
 * PDF.js returns multi-letter Arabic items in one of two orders:
 * - connected letters drawn as one ligature glyph ("رب" for "بر", "ين" for "ني") come
 *   out in visual order;
 * - separate, unconnected glyphs merged into one item ("ام", "زار") come out in logical
 *   order — and their width is exactly the sum of the isolated letters.
 * Returns the item text in visual order.
 */
function visualItemText(str, item, widths) {
  const letters = [...str];
  if (letters.length < 2 || !hasArabic(str) || hasPresentationForms(str)) return str;
  const reversed = [...letters].reverse().join('');
  if (hasJoins(str)) return str; // read as logical it would be connected → it is a ligature
  if (!hasJoins(reversed)) return reversed; // unconnected either way (e.g. "ر او و", "ع\ا")
  const size = itemSize(item);
  const isolated = shapedWidth(str, item.fontName, size, widths);
  if (isolated == null) return orientToken(str.replace(/\s+/g, '')).reversed ? str : reversed;
  return Math.abs(isolated - item.width) <= 0.15 * size ? reversed : str;
}

/**
 * Group PDF.js text items into reading lines with layout metadata.
 * Rows come from the position across the baseline (rotated text, e.g. vertical day
 * labels, is read along its own baseline). Within a row items are ordered along the
 * baseline; the gap between items and explicit space items mark word breaks, and
 * `widths` (from buildGlyphWidths over the whole document) fixes each item's order.
 */
export function reconstructPdfLines(items, { page = 1, widths = buildGlyphWidths(items) } = {}) {
  const rows = [];
  for (const item of items || []) {
    const str = cleanItemString(item.str ?? '');
    if (!str) continue;
    const t = item.transform || [1, 0, 0, 1, 0, 0];
    const size = itemSize(item);
    const len = Math.hypot(t[0], t[1]) || 1;
    const dx = t[0] / len,
      dy = t[1] / len;
    const orient = `${Math.round(dx)},${Math.round(dy)}`;
    const pos = t[4] * dx + t[5] * dy;
    const perp = t[5] * dx - t[4] * dy;
    let row = rows.find(
      (r) => r.orient === orient && Math.abs(r.perp - perp) < Math.max(2, size * 0.45),
    );
    if (!row) {
      row = { orient, perp, size, items: [] };
      rows.push(row);
    }
    row.size = Math.max(row.size, size);
    row.items.push({ str, pos, width: item.width ?? 0, size, font: item.fontName, item });
  }
  rows.sort((a, b) => b.perp - a.perp);
  return rows
    .map((row, index) => {
      const parts = row.items.sort((a, b) => a.pos - b.pos);
      const arabic = parts.filter((p) => hasArabic(p.str));
      const glyphLevel =
        arabic.length > 0 &&
        arabic.filter((p) => [...p.str.trim()].length <= 3).length / arabic.length > 0.6;
      const visualMode = parts.some((p) => hasPresentationForms(p.str)) || glyphLevel;
      const tokens = [];
      let prev = null,
        space = false;
      for (const p of parts) {
        if (!p.str.trim()) {
          space = true;
          continue;
        }
        const gap = prev ? p.pos - (prev.pos + prev.width) : 0;
        const text = visualMode && hasArabic(p.str) ? visualItemText(p.str, p.item, widths) : p.str;
        text
          .trim()
          .split(/\s+/)
          .forEach((piece, i) => {
            tokens.push({
              text: piece,
              gapBefore: !tokens.length ? null : i > 0 || space || gap > p.size * 0.15,
              visual: visualMode,
            });
          });
        prev = p;
        space = false;
      }
      let text, repaired;
      if (visualMode) ({ text, repaired } = repairArabicVisualOrder(tokens, { force: true }));
      else {
        // Already-logical items: right-to-left rows read from the rightmost item.
        const ordered = arabic.length > parts.length / 2 ? [...parts].reverse() : parts;
        text = normalizeArabicText(ordered.map((p) => p.str).join(' '));
        repaired = false;
      }
      const fonts = new Map();
      for (const p of arabic.length ? arabic : parts)
        fonts.set(p.font, (fonts.get(p.font) || 0) + 1);
      return {
        text,
        original: parts.map((p) => p.str).join(''),
        repaired,
        page,
        index,
        rotated: row.orient !== '1,0',
        y: row.perp,
        size: row.size,
        font: [...fonts].sort((a, b) => b[1] - a[1])[0]?.[0],
        xMin: Math.min(...parts.map((p) => p.pos)),
        xMax: Math.max(...parts.map((p) => p.pos + p.width)),
      };
    })
    .filter((l) => l.text)
    .map((line, i, all) => ({ ...line, gapAbove: i ? all[i - 1].y - line.y : null }));
}

// ---------------------------------------------------------------------------
// Weights and headings
// ---------------------------------------------------------------------------
const UNIT = '(?:جرام|غرام|جم|غم|ج|غ|grams?|gr|g)';
const NUM = '(\\d{1,4}(?:\\.\\d+)?)';

/** Repairs OCR/PDF corruptions of the gram marker before matching. */
function preNormalizeWeights(s) {
  return s
    .replace(/[＞﹥›]/g, '>')
    .replace(/\(\s*(?:ρ|p|р|ج|جم)\s*\|?\s*>\s*(\d+(?:\.\d+)?)\s*\)/gi, '($1 جم)')
    .replace(/\b(?:p|ρ|р)\s*[>|:]\s*(\d+(?:\.\d+)?)/gi, '$1 جم')
    .replace(/(?:جم|ج|جرام)\s*[|>:]+\s*(?:ج\s*>\s*)?(\d+(?:\.\d+)?)/gi, '$1 جم')
    .replace(/\(\s*(\d+(?:\.\d+)?)\s*\)\s*(?:جرام|جم|غرام|g)(?=\s|$)/gi, '($1 جم)');
}

/**
 * Extracts a food's gram target. Only accepts a number tied to a gram unit, and only
 * when it sits at the start or end of the line or in parentheses — so sentences such
 * as "ممكن نبدل 80 جم من الصدور…" stay notes, and calories/percentages are ignored.
 * Returns { grams, name } or null.
 */
export function extractFoodWeight(text) {
  const s = preNormalizeWeights(normalizeArabicText(text));
  const patterns = [
    new RegExp(`\\(\\s*${NUM}\\s*${UNIT}\\s*\\)`, 'iu'),
    new RegExp(`\\(\\s*${UNIT}\\s*${NUM}\\s*\\)`, 'iu'),
    new RegExp(`^${NUM}\\s*${UNIT}(?=\\s|$)`, 'iu'),
    new RegExp(`(?:^|\\s)${NUM}\\s*${UNIT}$`, 'iu'),
    new RegExp(`^${UNIT}\\s*${NUM}(?=\\s|$)`, 'iu'),
    // Some PDF fonts have no text mapping for the unit glyphs, which arrive as U+FFFD
    // (sometimes with the readable tail "ام" of "جرام"); next to a number in parentheses
    // they can only be the unit.
    new RegExp(`\\(\\s*${NUM}\\s*(?:${UNKNOWN_GLYPH}\\s*)+(?:ام|م)?\\s*\\)`, 'u'),
    new RegExp(`\\(\\s*(?:${UNKNOWN_GLYPH}\\s*)+(?:ام|م)?\\s*${NUM}\\s*\\)`, 'u'),
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const grams = Number(m[1]);
    if (!(grams > 0) || grams > 5000) continue;
    const after = s.slice(m.index + m[0].length);
    if (/^\s*%/.test(after)) continue;
    const name = (s.slice(0, m.index) + ' ' + after)
      .replace(/\(\s*\)/g, ' ')
      .replace(/^[\s•●·:\-–—|]+|[\s•●·:\-–—|]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return { grams, name };
  }
  return null;
}

const HEADINGS = [
  ['breakfast', /^(?:breakfast|iftar|فطار|افطار|الافطار|الفطور|وجبه الافطار)$/],
  ['lunch', /^(?:lunch|غداء|الغداء|وجبه الغداء)$/],
  ['dinner', /^(?:dinner|sohour|suhoor|suhour|sahur|عشاء|العشاء|وجبه العشاء|سحور|السحور)$/],
  [
    'snack',
    /^(?:snacks?|سناك|وجبه خفيفه|سناك \d|pre[- ]?breakfast|(?:before|pre)[- ]?workout|(?:after|post)[- ]?workout|قبل التمرين|بعد التمرين)$/,
  ],
  ['supplements', /^(?:supplements?|مكملات|المكملات|المكملات الغذائيه)$/],
];
const PLAIN_HEADINGS =
  /^(?:breakfast|lunch|dinner|snacks?|supplements?|فطار|افطار|الافطار|الفطور|غداء|الغداء|عشاء|العشاء|سناك|مكملات|المكملات)$/;

/**
 * Meal heading → { kind, label }. `label` keeps the coach's own title (e.g.
 * "Before Workout", "Ramadan:Sohour") when it says more than the kind, else ''.
 */
export function mealHeading(text) {
  const t = canonicalArabic(text);
  if (t.length > 40 || extractFoodWeight(text)) return null;
  const head = t
    .replace(/^\d+[.)\s-]*/, '')
    .replace(/^(?:ramadan|رمضان)\s*[:\-–]\s*/, '')
    .replace(/[:\s\d]+$/, '');
  const match = HEADINGS.find(([, re]) => re.test(head));
  if (!match) return null;
  const label = PLAIN_HEADINGS.test(t.replace(/[:\s\d]+$/, '')) ? '' : normalizeArabicText(text);
  return { kind: match[0], label };
}

/** Returns the meal kind when the line is a section heading, otherwise null. */
export function identifyMealSection(text) {
  return mealHeading(text)?.kind ?? null;
}

/** "اليوم 2" / "Day 2" separators between alternative day plans → 2. */
export function detectDayMarker(text) {
  const m = canonicalArabic(text).match(/^(?:اليوم|يوم|day)\s*(\d{1,2})$/);
  return m ? Number(m[1]) : null;
}

export function detectAlternativesHeading(text) {
  const t = canonicalArabic(text).replace(/[\s:.\-–—•]/g, '');
  return /^(?:البدائل|بدائل|البديل|بديل|alternatives?|substitutes?|or)$/.test(t);
}

const SUMMARY_START_RE = /^(?:ملخص النظام الغذائي|الفيتامينات|nutrition summary|summary)/;
const MACRO_WORDS_RE =
  /(?:السعرات|البروتين|الكربوهيدرات|الدهون|calories|kcal|protein|carbs?|fats?)/gi;
const NUTRIENT_RE = /^(?:[A-Z][A-Z0-9 ]+\s*\d+(?:\.\d+)?\s*){2,}$/;
/** The plan-wide nutrition summary: everything after it is not a meal. */
const isSummaryStart = (text) => SUMMARY_START_RE.test(canonicalArabic(text));
/** Macro / nutrient rows (per meal or in tables) that are never foods. */
function isNutritionInfoLine(text) {
  return (
    (canonicalArabic(text).match(MACRO_WORDS_RE) || []).length >= 2 ||
    NUTRIENT_RE.test(text) ||
    /^(?:\d+(?:\.\d+)?\s+){2,}\d+(?:\.\d+)?$/.test(text)
  );
}

// ---------------------------------------------------------------------------
// Plan objects (same shape the tracker stores)
// ---------------------------------------------------------------------------
export function makeOption(name, grams) {
  return { id: uid(), name: normalizeArabicText(name), grams: Number(grams) || 0 };
}
export function makeSlot(name, grams, alternatives = []) {
  return {
    id: uid(),
    primary: makeOption(name, grams),
    alternatives: alternatives.map((a) => makeOption(a[0], a[1])),
  };
}
export function makeMeal(kind, note = '') {
  return { id: uid(), kind, note, slots: [] };
}

// ---------------------------------------------------------------------------
// D. Meal structure
// ---------------------------------------------------------------------------
const close = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

/**
 * Decides whether a food line that follows an alternatives list starts a new primary.
 * Uses layout first (font size, right edge for RTL / left edge for LTR, block gaps),
 * then the "item right before البدائل is a primary" rule, then a weak gram heuristic
 * that is flagged for review.
 */
function classifyAfterAlternatives(line, ctx) {
  const { primaryLine, firstAltLine, nextIsAltHeading, slot, grams } = ctx;
  if (nextIsAltHeading) return { primary: true, certain: true };
  if (
    line.font &&
    primaryLine?.font &&
    firstAltLine?.font &&
    primaryLine.font !== firstAltLine.font
  ) {
    if (line.font === primaryLine.font) return { primary: true, certain: true };
    if (line.font === firstAltLine.font) return { primary: false, certain: true };
  }
  if (line.size != null && primaryLine?.size != null && firstAltLine?.size != null) {
    const edge = (l) => (hasArabic(l.text) ? l.xMax : l.xMin);
    const tol = Math.max(2, line.size * 0.6);
    const likePrimary =
      close(line.size, primaryLine.size, 0.4) && close(edge(line), edge(primaryLine), tol);
    const likeAlt =
      close(line.size, firstAltLine.size, 0.4) && close(edge(line), edge(firstAltLine), tol);
    if (likePrimary && !likeAlt) return { primary: true, certain: true };
    if (likeAlt && !likePrimary) return { primary: false, certain: true };
    if (
      line.gapAbove != null &&
      firstAltLine.gapAbove != null &&
      line.gapAbove > firstAltLine.gapAbove * 1.7
    )
      return { primary: true, certain: true };
  }
  const sameAsAlt = slot.alternatives.some((a) => a.grams === grams);
  return { primary: !sameAsAlt, certain: false };
}

/**
 * Builds the plan from reconstructed lines ({ text, size?, font?, xMin?, xMax?, gapAbove? }).
 * Slots whose primary/alternative grouping could not be proven carry `review: true`.
 * PDFs with several day plans ("اليوم 1", "اليوم 2", …) yield `days`; only `day`
 * (default: the first) is returned as meals. Both markers are stripped before saving.
 */
export function parseMealSections(lines, { day } = {}) {
  const list = lines
    .map((l) => (typeof l === 'string' ? { text: l } : l))
    .filter((l) => l.text?.trim());
  const meals = [];
  const days = [];
  let dayNo = null;
  let current = null,
    slot = null,
    mode = 'primary',
    primaryLine = null,
    firstAltLine = null;
  const isAltHeadingAt = (i) => {
    for (let j = i + 1; j < list.length; j++) {
      const t = list[j].text;
      if (detectAlternativesHeading(t)) return true;
      if (extractFoodWeight(t) || identifyMealSection(t)) return false;
    }
    return false;
  };
  list.forEach((line, i) => {
    const text = line.text;
    const marker = detectDayMarker(text);
    if (marker != null) {
      dayNo = marker;
      if (!days.includes(marker)) days.push(marker);
      current = null;
      return;
    }
    const heading = mealHeading(text);
    if (heading) {
      current = makeMeal(heading.kind, heading.label);
      current.day = dayNo;
      meals.push(current);
      slot = null;
      mode = 'primary';
      return;
    }
    if (!current) return;
    if (isSummaryStart(text)) {
      current = null;
      return;
    }
    if (isNutritionInfoLine(text)) return;
    if (detectAlternativesHeading(text)) {
      if (slot) {
        mode = 'alts-start';
        firstAltLine = null;
      }
      return;
    }
    const food = extractFoodWeight(text);
    if (!food) {
      if (!slot && text.length > 8 && !/\d{4,}/.test(text) && !text.includes(UNKNOWN_GLYPH))
        current.note = current.note ? `${current.note} — ${text}` : text;
      return;
    }
    if (!food.name) return;
    if (mode === 'alts-start') {
      slot.alternatives.push(makeOption(food.name, food.grams));
      firstAltLine = line;
      mode = 'alts';
      return;
    }
    if (mode === 'alts') {
      const verdict = classifyAfterAlternatives(line, {
        primaryLine,
        firstAltLine,
        nextIsAltHeading: isAltHeadingAt(i),
        slot,
        grams: food.grams,
      });
      if (!verdict.primary) {
        slot.alternatives.push(makeOption(food.name, food.grams));
        if (!verdict.certain) slot.review = true;
        return;
      }
      mode = 'primary';
      slot = makeSlot(food.name, food.grams);
      if (!verdict.certain) slot.review = true;
      current.slots.push(slot);
      primaryLine = line;
      return;
    }
    slot = makeSlot(food.name, food.grams);
    current.slots.push(slot);
    primaryLine = line;
  });
  const selected = day ?? days[0] ?? null;
  return {
    id: uid(),
    name: 'Imported nutrition plan',
    createdAt: new Date().toISOString(),
    origin: 'import',
    notes: '',
    ...(days.length > 1 ? { days, day: selected } : {}),
    meals: meals
      .filter((m) => m.slots.length && (days.length < 2 || m.day === selected))
      .map(({ day: _day, ...meal }) => meal),
  };
}

/** Plain-text entry point (pasted text or text copied out of a PDF viewer). */
export function parseMealText(input, options) {
  const lines = String(input || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((raw) => repairArabicVisualOrder(raw).text)
    .filter(Boolean);
  return parseMealSections(lines, options);
}

// ---------------------------------------------------------------------------
// Optional supplements (whey) swap
// ---------------------------------------------------------------------------
// "درجاج" covers the scrambled "صددرجاج" that some PDFs extract for "صدر دجاج".
const CHICKEN_RE = /صدر|صدور|دجاج|درجاج|chicken|breast/i;
const DEFAULT_WHEY_SWAP = 80;

/**
 * Supplements are optional: the coach's note ("ممكن نبدل 80 جم من الصدور الموجودة في
 * الغداء بسكوب واي") swaps grams of chicken breast for a whey scoop. Returns the plan as
 * it applies for the day plus the slot that was reduced and by how much.
 * - take = false: supplement meals are dropped, everything else unchanged.
 * - take = true: supplement meals stay and the chicken slot (preferring lunch) loses the
 *   swap grams from its primary and every alternative.
 */
export function applySupplementChoice(plan, take) {
  const meals = plan?.meals || [];
  const supplements = meals.filter((m) => m.kind === 'supplements');
  if (!supplements.length) return { plan, hasSupplements: false, swap: null };
  if (!take)
    return {
      plan: { ...plan, meals: meals.filter((m) => m.kind !== 'supplements') },
      hasSupplements: true,
      swap: null,
    };
  const noteGrams = supplements
    .map((m) => normalizeDigits(m.note || '').match(/(\d{1,4})\s*(?:جم|جرام|غرام|grams?|g)(?![a-z])/i))
    .find(Boolean);
  const grams = noteGrams ? Number(noteGrams[1]) : DEFAULT_WHEY_SWAP;
  const isChicken = (slot) => CHICKEN_RE.test(canonicalArabic(slot.primary?.name || ''));
  const target =
    meals.filter((m) => m.kind === 'lunch').flatMap((m) => m.slots || []).find(isChicken) ||
    meals.flatMap((m) => m.slots || []).find(isChicken);
  if (!target) return { plan, hasSupplements: true, swap: null };
  const reduce = (o) => ({ ...o, grams: Math.max(0, (+o.grams || 0) - grams) });
  return {
    plan: {
      ...plan,
      meals: meals.map((m) => ({
        ...m,
        slots: (m.slots || []).map((s) =>
          s === target
            ? { ...s, primary: reduce(s.primary), alternatives: (s.alternatives || []).map(reduce) }
            : s,
        ),
      })),
    },
    hasSupplements: true,
    swap: { slotId: target.id, name: target.primary.name, grams },
  };
}

/** Drops parse-time review markers before a plan is persisted. */
export function stripReviewFlags({ days, day, ...plan }) {
  return {
    ...plan,
    meals: plan.meals.map((m) => ({ ...m, slots: m.slots.map(({ review, ...slot }) => slot) })),
  };
}

// ---------------------------------------------------------------------------
// PDF.js loading / extraction (browser only)
// ---------------------------------------------------------------------------
let pdfPromise;
export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfPromise)
    pdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        const lib = window.pdfjsLib;
        if (!lib) return reject(new Error('PDF.js unavailable'));
        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(lib);
      };
      s.onerror = () => reject(new Error('Unable to load PDF.js CDN script'));
      document.head.appendChild(s);
    }).catch((e) => {
      pdfPromise = undefined;
      throw e;
    });
  return pdfPromise;
}

/** Extracts reconstructed lines for every page. `lib` is injectable for Node tests. */
export async function extractPdfLines(data, lib) {
  const doc = await lib.getDocument({ data }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    pages.push((await page.getTextContent()).items);
  }
  // Glyph widths are learned from the whole document, then used to order each page's items.
  const widths = buildGlyphWidths(pages.flat());
  return pages.flatMap((items, i) => reconstructPdfLines(items, { page: i + 1, widths }));
}

/** Browser entry point: returns repaired text (for the review/debug view), lines and the draft plan. */
export async function parseNutritionPdf(file) {
  const lib = await loadPdfJs();
  const lines = await extractPdfLines(new Uint8Array(await file.arrayBuffer()), lib);
  if (typeof console !== 'undefined')
    console.debug(
      '[planParser] PDF lines',
      lines.map(({ original, text, repaired, confident }) => ({
        original,
        text,
        repaired,
        confident,
      })),
    );
  return { text: lines.map((l) => l.text).join('\n'), lines, plan: parseMealSections(lines) };
}
