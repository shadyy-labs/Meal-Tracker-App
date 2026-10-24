import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applySupplementChoice,
  canonicalArabic,
  detectAlternativesHeading,
  extractFoodWeight,
  identifyMealSection,
  normalizeArabicText,
  normalizeDigits,
  parseMealSections,
  parseMealText,
  reconstructPdfLines,
  repairArabicVisualOrder,
  stripReviewFlags,
} from '../src/planParser.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const repair = (s) => repairArabicVisualOrder(s).text;
const same = (actual, expected) => assert.equal(canonicalArabic(actual), canonicalArabic(expected));

// 1. Presentation Forms → base letters
test('normalizes Arabic Presentation Forms to standard letters', () => {
  assert.equal(normalizeArabicText('ﺗﻮﺳﺖ'), 'توست');
  assert.equal(normalizeArabicText('ﻻ'), 'لا');
  assert.equal(normalizeArabicText('‏جبنة‬  قريش'), 'جبنة قريش');
});

// 2 + 3. Reversed words with a space between every glyph
test('repairs reversed, letter-spaced Arabic words', () => {
  assert.equal(repair('ين ﺑ ﺖ ﺳ ﻮ ﺗ'), 'توست بني');
  assert.equal(repair('ﻞ ﺋ ا ﺪ ﺒ ﻟ ا'), 'البدائل');
  assert.equal(repair('ﻞ ﻣ ﺎ ﻛ ق ﻮ ﻠ ﺴ ﻣ ﺾ ﻴ ﺑ'), 'بيض مسلوق كامل');
  assert.equal(repair('ﺔ ﻴ ﻟ ﺎ ﺧ ر ﺪ ﻴ ﺸ ﻟ ا ﺔ ﻨ ﺒ ﺟ'), 'جبنة الشيدر خالية');
});

// 4. Mixed Arabic + Latin, Latin order preserved
test('keeps Latin product names in reading order inside Arabic lines', () => {
  assert.equal(
    repair('( ام ﺮ ﺟ 33 ) Limitless Alpha Concentrate Whey Protein'),
    'Limitless Alpha Concentrate Whey Protein (33 جرام)',
  );
});

// 5. Digits
test('normalizes Arabic-Indic and Eastern Arabic-Indic digits', () => {
  assert.equal(normalizeDigits('١٥٠ جم'), '150 جم');
  assert.equal(normalizeDigits('۱۲۰'), '120');
  assert.equal(normalizeDigits('٢٫٥'), '2.5');
});

// 6. Gram units in correct, reversed and corrupted forms
test('extracts gram weights from correct and corrupted patterns', () => {
  const cases = [
    ['توست بني (60 جرام)', 60, 'توست بني'],
    ['تورتيلا (50 جم)', 50, 'تورتيلا'],
    ['بيض ( 110 جرام )', 110, 'بيض'],
    [repair('( ام ﺮ ﺟ 60 ) ين ﺑ ﺖ ﺳ ﻮ ﺗ'), 60, 'توست بني'],
    ['صدر دجاج (ρ|>180)', 180, 'صدر دجاج'],
    ['أرز (جم|ج>220)', 220, 'أرز'],
    ['شوفان (p>30)', 30, 'شوفان'],
    ['زيت (5) جرام', 5, 'زيت'],
    ['واي بروتين (33) جرام', 33, 'واي بروتين'],
    ['أرز مطهي 150 جم', 150, 'أرز مطهي'],
    ['180 جرام سمك', 180, 'سمك'],
    ['Oats 40 g', 40, 'Oats'],
  ];
  for (const [text, grams, name] of cases) {
    const w = extractFoodWeight(text);
    assert.ok(w, text);
    assert.equal(w.grams, grams, text);
    assert.equal(w.name, name, text);
  }
});

// 15. Missing / non-food numbers
test('does not invent weights from percentages, calories, or sentences', () => {
  assert.equal(extractFoodWeight('شوكولاتة دارك 70%-85% كاكاو'), null);
  assert.equal(extractFoodWeight('2129.25 179.26 218.12 67.86'), null);
  assert.equal(extractFoodWeight('ممكن نبدل 80 جم من الصدور الموجودة في الغداء بسكوب واي'), null);
  assert.equal(extractFoodWeight('المكرونة مرتين فقط في الاسبوع'), null);
  assert.equal(extractFoodWeight('خس'), null);
});

// 7. Alternatives heading
test('detects the alternatives heading in normalized, spaced and English forms', () => {
  assert.ok(detectAlternativesHeading('البدائل'));
  assert.ok(detectAlternativesHeading('البدائل:'));
  assert.ok(detectAlternativesHeading(repair('ﻞ ﺋ ا ﺪ ﺒ ﻟ ا')));
  assert.ok(detectAlternativesHeading('Alternatives'));
  assert.ok(!detectAlternativesHeading('بدائل الأرز (150 جم)'));
});

// 11. Meal section boundaries
test('identifies meal headings but not foods or long sentences', () => {
  assert.equal(identifyMealSection('Breakfast'), 'breakfast');
  assert.equal(identifyMealSection('Snack'), 'snack');
  assert.equal(identifyMealSection('الغداء'), 'lunch');
  assert.equal(identifyMealSection('Supplements'), 'supplements');
  assert.equal(identifyMealSection('جبن فطار (30 جم)'), null);
  assert.equal(identifyMealSection('ممكن نبدل 80 جم من الصدور الموجودة في الغداء بسكوب واي'), null);
});

// 14. Already-correct text stays as-is
test('leaves already-correct logical Arabic untouched', () => {
  const lines = ['صدر دجاج مشوي - لحم فقط (180 جرام)', 'شوكولاتة دارك، 70%-85% كاكاو (20 جرام)'];
  for (const l of lines) assert.equal(repair(l), l);
  const plan = parseMealText('Breakfast\nتوست بني (60 جرام)\nالبدائل\nتورتيلا (50 جم)');
  same(plan.meals[0].slots[0].primary.name, 'توست بني');
  same(plan.meals[0].slots[0].alternatives[0].name, 'تورتيلا');
});

// 8. Alternative assignment: the food right before البدائل is always a primary
test('assigns alternatives to the preceding primary and starts a new primary before the next heading', () => {
  const plan = parseMealText(
    [
      'Breakfast',
      'توست بني (60 جرام)',
      'البدائل',
      'تورتيلا (50 جم)',
      'جبنة قريش (50 جرام)',
      'البدائل',
      'جبنة الشيدر خالية من الدهون (30 جم)',
    ].join('\n'),
  );
  const [toast, cheese] = plan.meals[0].slots;
  assert.deepEqual(
    toast.alternatives.map((a) => [a.name, a.grams]),
    [['تورتيلا', 50]],
  );
  assert.equal(cheese.primary.name, 'جبنة قريش');
  assert.equal(cheese.primary.grams, 50);
  assert.deepEqual(
    cheese.alternatives.map((a) => a.grams),
    [30],
  );
});

// 16. Ambiguous grouping is flagged, not silently trusted
test('flags foods after an alternatives list whose grouping cannot be proven', () => {
  const plan = parseMealText(
    ['Lunch', 'أرز (150 جم)', 'البدائل', 'أرز بني (150 جم)', 'سلطة (200 جم)'].join('\n'),
  );
  const flagged = plan.meals[0].slots.filter((s) => s.review);
  assert.equal(flagged.length, 1);
  // Review markers never reach storage.
  assert.ok(stripReviewFlags(plan).meals.every((m) => m.slots.every((s) => !('review' in s))));
});

// Layout signals (from PDF geometry) resolve the grouping with certainty.
test('uses font size / indentation to separate alternatives from the next primary', () => {
  const L = (text, size, xMax) => ({ text, size, xMax, xMin: 0 });
  const plan = parseMealSections([
    L('Lunch', 14, 500),
    L('صدر دجاج مشوي (180 جرام)', 11, 500),
    L('البدائل', 10, 480),
    L('بوري مشوي (180 جم)', 10, 480),
    L('ستيك بقري مشوي (180 جم)', 10, 480),
    L('سلطة (200 جرام)', 11, 500),
  ]);
  const [chicken, salad] = plan.meals[0].slots;
  assert.deepEqual(
    chicken.alternatives.map((a) => a.name),
    ['بوري مشوي', 'ستيك بقري مشوي'],
  );
  assert.equal(salad.primary.name, 'سلطة');
  assert.ok(!chicken.review && !salad.review);
});

// 9. Multiple Snack sections stay separate
test('keeps repeated Snack sections as separate meals', () => {
  const plan = parseMealText('Snack\nموز (100 جرام)\nLunch\nأرز (150 جم)\nSnack\nلوز (30 جرام)');
  assert.deepEqual(
    plan.meals.map((m) => m.kind),
    ['snack', 'lunch', 'snack'],
  );
});

// 12. Nutrition summary tables are not foods
test('stops at the nutrition summary and ignores nutrient tables', () => {
  const plan = parseMealText(
    [
      'Supplements',
      'Whey Protein (33 جرام)',
      'ملخص النظام الغذائي',
      'الدهون الكربوهيدرات البروتين السعرات',
      '2129.25 179.26 218.12 67.86',
      'ASH 9.07 IRON 12.73 ZINC 10.29 FIBER 18.38',
      'سمك (100 جم)',
    ].join('\n'),
  );
  assert.equal(plan.meals.length, 1);
  assert.equal(plan.meals[0].slots.length, 1);
});

// 13. Latin supplement names
test('preserves Latin supplement names', () => {
  const plan = parseMealText('Supplements\nLimitless Alpha Concentrate Whey Protein (33 جرام)');
  assert.equal(plan.meals[0].slots[0].primary.name, 'Limitless Alpha Concentrate Whey Protein');
  assert.equal(plan.meals[0].slots[0].primary.grams, 33);
});

// 17. IDs and stored shape stay compatible with daily logs
test('produces unique ids and the stored plan shape the tracker expects', () => {
  const plan = stripReviewFlags(parseMealText(fixture('shady-walid-extracted.txt')));
  const ids = plan.meals.flatMap((m) => [
    m.id,
    ...m.slots.flatMap((s) => [s.id, s.primary.id, ...s.alternatives.map((a) => a.id)]),
  ]);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of plan.meals) {
    assert.deepEqual(Object.keys(m).sort(), ['id', 'kind', 'note', 'slots']);
    for (const s of m.slots) {
      assert.deepEqual(Object.keys(s).sort(), ['alternatives', 'id', 'primary']);
      for (const o of [s.primary, ...s.alternatives])
        assert.deepEqual(Object.keys(o).sort(), ['grams', 'id', 'name']);
    }
  }
});

// PDF geometry: word breaks come from x-gaps, not from the item strings.
test('reconstructs words from PDF item positions', () => {
  // Visual (left→right) glyph items for "توست بني (60 جرام)"; null marks a word gap.
  const visual = [
    '(',
    null,
    'ام',
    'ﺮ',
    'ﺟ',
    null,
    '60',
    null,
    ')',
    null,
    'ين',
    'ﺑ',
    null,
    'ﺖ',
    'ﺳ',
    'ﻮ',
    'ﺗ',
  ];
  let x = 0;
  const items = [];
  for (const g of visual) {
    if (g === null) {
      x += 4;
      continue;
    }
    const width = 5 * [...g].length;
    items.push({ str: g, transform: [10, 0, 0, 10, x, 700], width, height: 10 });
    x += width;
  }
  const [line] = reconstructPdfLines(items);
  assert.equal(line.text, 'توست بني (60 جرام)');
  assert.equal(line.repaired, true);
});

// 10. Regression on the real extraction output of Diet-week-2-3-5107.pdf (text only).
test('regression: extracted text of the Shady Walid plan', () => {
  const plan = parseMealText(fixture('shady-walid-extracted.txt'));
  assert.deepEqual(
    plan.meals.map((m) => m.kind),
    ['breakfast', 'snack', 'lunch', 'snack', 'dinner', 'supplements'],
  );
  const byName = new Map();
  for (const m of plan.meals)
    for (const s of m.slots)
      for (const o of [s.primary, ...s.alternatives]) byName.set(canonicalArabic(o.name), o.grams);
  const expected = [
    ['توست بني', 60],
    ['تورتيلا', 50],
    ['بيض مسلوق كامل', 110],
    ['جبنة قريش', 50],
    ['جبنة الشيدر خالية من الدهون', 30],
    ['خس', 100],
    ['شوفان سريع الطهي من لينو', 30],
    ['بيض كامل', 55],
    ['لبن خالي من الدسم', 240],
    ['خلاصة الفانيليا', 5],
    ['بيكنج بودر', 5],
    ['موز', 100],
    ['تفاح', 150],
    ['فراولة', 280],
    ['لوز', 30],
    ['أرز بسمتي مسلوق', 150],
    ['أرز بنى مطهي', 150],
    ['مكرونة القمح الكامل مطهية', 120],
    ['ستيك بقري مشوي', 180],
    ['سمك البلطي مشوي', 180],
    ['كفته مشوية', 180],
    ['زيت الزيتون', 5],
    ['بطاطا حلوة مشوية', 100],
    ['بلح - تمر مجفف', 30],
    ['شوكلاتة دارك، 70%-85% كاكاو', 20],
    ['سمك التونة الأبيض المعلب في الزيت - مصفى', 120],
    ['Limitless Alpha Concentrate Whey Protein', 33],
  ];
  for (const [name, grams] of expected)
    assert.equal(byName.get(canonicalArabic(name)), grams, name);
  // Definite groupings (the food right after البدائل).
  const breakfast = plan.meals[0].slots;
  assert.equal(breakfast[0].alternatives[0].name, 'تورتيلا');
  assert.equal(breakfast.find((s) => s.primary.name === 'جبنة قريش').alternatives[0].grams, 30);
  // The whey note stays a note, it does not become a food.
  assert.match(plan.meals[5].note, /80 جم/);
  assert.equal(plan.meals[5].slots.length, 1);
});

// End-to-end on the real PDF — runs only when the file is present.
const PDF = new URL('./fixtures/Diet-week-2-3-5107.pdf', import.meta.url);
test(
  'regression: Diet-week-2-3-5107.pdf end to end',
  { skip: !fs.existsSync(PDF) && 'PDF not in test/fixtures' },
  async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    const { extractPdfLines } = await import('../src/planParser.js');
    const lines = await extractPdfLines(
      new Uint8Array(fs.readFileSync(PDF)),
      pdfjs.default ?? pdfjs,
    );
    const plan = parseMealSections(lines);
    const expected = {
      breakfast: [
        ['توست بني', 60, [['تورتيلا', 50]]],
        ['بيض مسلوق كامل', 110, []],
        ['جبنة قريش', 50, [['جبنة الشيدر خالية من الدهون', 30]]],
        ['خس', 100, []],
      ],
      snack1: [
        ['شوفان سريع الطهي من لينو', 30, []],
        ['بيض كامل', 55, []],
        ['لبن خالي من الدسم', 240, []],
        ['خلاصة الفانيليا', 5, []],
        ['بيكنج بودر', 5, []],
        [
          'موز',
          100,
          [
            ['تفاح', 150],
            ['فراولة', 280],
          ],
        ],
        ['لوز', 30, []],
      ],
      lunch: [
        [
          'أرز بسمتي مسلوق',
          150,
          [
            ['أرز بني مطهي', 150],
            ['مكرونة القمح الكامل مطهية', 120],
          ],
        ],
        [
          'صدر دجاج مشوي - لحم فقط',
          180,
          [
            ['بوري مشوي', 180],
            ['ستيك بقري مشوي', 180],
            ['سمك البلطي مشوي', 180],
            ['كفتة مشوية', 180],
          ],
        ],
        ['سلطة (طماطم وجزر وفلفل وخيار)', 200, []],
        ['زيت الزيتون', 5, []],
      ],
      snack2: [
        [
          'موز',
          100,
          [
            ['بطاطا حلوة مشوية', 100],
            ['بلح - تمر مجفف', 30],
          ],
        ],
        ['شوكولاتة دارك 70%-85% كاكاو', 20, []],
      ],
      dinner: [
        ['تورتيلا', 50, []],
        ['صدر دجاج مشوي - لحم فقط', 100, [['سمك التونة الأبيض المعلب في الزيت - مصفى', 120]]],
        ['خس', 100, []],
      ],
      supplements: [['Limitless Alpha Concentrate Whey Protein', 33, []]],
    };
    const loose = (s) =>
      canonicalArabic(s)
        .replace(/[\s،,]/g, '')
        .replace(/و(?=لا)/, '');
    const actual = plan.meals.map((m) =>
      m.slots.map((s) => [
        loose(s.primary.name),
        s.primary.grams,
        s.alternatives.map((a) => [loose(a.name), a.grams]),
      ]),
    );
    const want = Object.values(expected).map((slots) =>
      slots.map(([n, g, alts]) => [loose(n), g, alts.map(([an, ag]) => [loose(an), ag])]),
    );
    assert.deepEqual(actual, want);
  },
);

// Optional whey: off hides the supplements meal, on swaps grams off the lunch chicken.
test('applySupplementChoice toggles the whey swap', () => {
  const plan = parseMealText(fixture('shady-walid-extracted.txt'));
  const off = applySupplementChoice(plan, false);
  assert.equal(off.hasSupplements, true);
  assert.ok(off.plan.meals.every((m) => m.kind !== 'supplements'));
  assert.equal(off.swap, null);

  const on = applySupplementChoice(plan, true);
  assert.equal(on.swap.grams, 80);
  assert.ok(on.plan.meals.some((m) => m.kind === 'supplements'));
  const lunch = on.plan.meals.find((m) => m.kind === 'lunch');
  const chicken = lunch.slots.find((s) => s.id === on.swap.slotId);
  assert.match(chicken.primary.name, /لحم فقط/);
  assert.equal(chicken.primary.grams, 100);
  assert.ok(chicken.alternatives.every((a) => a.grams === 100));
  // The stored plan is never mutated.
  const original = plan.meals.find((m) => m.kind === 'lunch').slots.find((s) => s.id === chicken.id);
  assert.equal(original.primary.grams, 180);

  const plain = parseMealText('Lunch\nصدر دجاج (180 جرام)');
  assert.equal(applySupplementChoice(plain, true).hasSupplements, false);
});
