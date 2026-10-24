import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildGlyphWidths,
  detectDayMarker,
  extractFoodWeight,
  identifyMealSection,
  mealHeading,
  parseMealSections,
  parseMealText,
  reconstructPdfLines,
  stripReviewFlags,
} from '../src/planParser.js';

/** Lays out visual-order glyph items on one baseline; null inserts a space item. */
function row(glyphs, { y = 700, font = 'f1', size = 12 } = {}) {
  let x = 0;
  const items = [];
  for (const g of glyphs) {
    const [str, width] = g ?? [' ', 3.4];
    items.push({ str, transform: [size, 0, 0, size, x, y], width, fontName: font });
    x += width;
  }
  return items;
}

test('orders multi-letter PDF items: ligatures are visual, separate letters are logical', () => {
  const singles = row(
    [
      ['ا', 3.4],
      ['م', 7.9],
      ['ر', 4.3],
      ['ب', 9.8],
    ].flatMap((g) => [g, null]),
    { y: 100 },
  );
  const items = [
    ...singles,
    // "توست بني": "ين" is one ligature glyph (visual order)
    ...row([['ين', 12.6], ['ﺑ', 4], null, ['ﺖ', 9.8], ['ﺳ', 10.3], ['ﻮ', 6.7], ['ﺗ', 4.6]], {
      y: 600,
    }),
    // "الموزاريلا": "زار" is three separate glyphs merged by PDF.js (logical order)
    ...row(
      [
        ['ﻼ', 8.4],
        ['ﻳ', 4.2],
        ['زار', 11.3],
        ['ﻮ', 6.5],
        ['ﻤ', 7.2],
        ['ﻟ', 3.8],
        ['ا', 3.1],
      ],
      { y: 560 },
    ),
    // "البروتين": "رب" is a joined pair, far narrower than separate ر + ب
    ...row(
      [
        ['ني', 12.2],
        ['ﺗ', 4.6],
        ['و', 6.7],
        ['رب', 8.4],
        ['ﻟ', 4],
        ['ا', 3.4],
      ],
      { y: 520 },
    ),
    // "(60 جرام)": "ام" is separate ا + م, its width equals the isolated letters
    ...row([['(', 4.9], ['ام', 11.3], ['ﺮ', 4.4], ['ﺟ', 7], null, ['60', 16.2], null, [')', 4.9]], {
      y: 480,
    }),
  ];
  const texts = reconstructPdfLines(items, { widths: buildGlyphWidths(items) }).map((l) => l.text);
  assert.deepEqual(texts.slice(0, 4), ['توست بني', 'الموزاريلا', 'البروتين', '(60 جرام)']);
});

test('reads rotated text (vertical day labels) along its baseline', () => {
  const glyphs = [
    ['1', 25.9],
    [' ', 14.9],
    ['م', 28.9],
    ['ﻮ', 24.9],
    ['ﻴ', 15.6],
    ['ﻟ', 13],
    ['ا', 11.5],
  ];
  let y = 37.7;
  const items = glyphs.map(([str, width]) => {
    const item = { str, transform: [0, 47.2, -47.2, 0, 573.9, y], width, fontName: 'f2' };
    y += width;
    return item;
  });
  const [line] = reconstructPdfLines(items);
  assert.equal(line.text, 'اليوم 1');
  assert.ok(line.rotated);
  assert.equal(detectDayMarker(line.text), 1);
});

test('treats unmapped unit glyphs next to a number as the gram unit', () => {
  const U = String.fromCharCode(0xfffd);
  assert.deepEqual(extractFoodWeight(`توست بني (60 ${U} ${U} ام)`), {
    grams: 60,
    name: 'توست بني',
  });
  assert.deepEqual(extractFoodWeight(`تورتيلا (50 ${U} ${U})`), { grams: 50, name: 'تورتيلا' });
  assert.equal(extractFoodWeight(`السعرات ${U} 463.90 البروتين ${U} 28.16`), null);
});

test('recognizes workout and Ramadan headings and keeps their titles', () => {
  assert.deepEqual(mealHeading('Before Workout'), { kind: 'snack', label: 'Before Workout' });
  assert.deepEqual(mealHeading('After Workout'), { kind: 'snack', label: 'After Workout' });
  assert.deepEqual(mealHeading('Ramadan:Pre-Breakfast'), {
    kind: 'snack',
    label: 'Ramadan:Pre-Breakfast',
  });
  assert.deepEqual(mealHeading('Ramadan:Breakfast'), {
    kind: 'breakfast',
    label: 'Ramadan:Breakfast',
  });
  assert.deepEqual(mealHeading('Ramadan:Sohour'), { kind: 'dinner', label: 'Ramadan:Sohour' });
  assert.deepEqual(mealHeading('Breakfast'), { kind: 'breakfast', label: '' });
  assert.equal(identifyMealSection('قبل التمرين بنص ساعه'), null);
});

test('skips per-meal macro lines without ending the meal', () => {
  const plan = parseMealText(
    'Breakfast\nالسعرات 463.90 البروتين 28.16 الدهون 22.06 الكربوهيدرات 37.85\nتوست بني (60 جرام)',
  );
  assert.equal(plan.meals.length, 1);
  assert.equal(plan.meals[0].slots[0].primary.name, 'توست بني');
  assert.equal(plan.meals[0].note, '');
});

test('uses the font to tell alternatives from the next primary', () => {
  const L = (text, font) => ({ text, font, size: 12, xMin: 0, xMax: 573 });
  const plan = parseMealSections([
    L('Breakfast', 'f2'),
    L('توست بني (60 جرام)', 'f1'),
    L('البدائل', 'f5'),
    L('تورتيلا (50 جم)', 'f5'),
    L('بيض مسلوق كامل (110 جرام)', 'f1'),
    L('تفاح (150 جرام)', 'f1'),
    L('البدائل', 'f5'),
    L('برتقال (180 جم)', 'f5'),
    L('رمان (120 جم)', 'f5'),
    L('خيار (100 جرام)', 'f1'),
  ]);
  const slots = plan.meals[0].slots;
  assert.deepEqual(
    slots.map((s) => [s.primary.name, s.alternatives.map((a) => a.name)]),
    [
      ['توست بني', ['تورتيلا']],
      ['بيض مسلوق كامل', []],
      ['تفاح', ['برتقال', 'رمان']],
      ['خيار', []],
    ],
  );
  assert.ok(slots.every((s) => !s.review));
});

test('splits multi-day plans and returns the requested day', () => {
  const text = 'اليوم 1\nBreakfast\nتوست (60 جم)\nاليوم 2\nRamadan:Sohour\nفول (150 جم)';
  const first = parseMealText(text);
  assert.deepEqual(first.days, [1, 2]);
  assert.deepEqual(
    first.meals.map((m) => m.kind),
    ['breakfast'],
  );
  const second = parseMealText(text, { day: 2 });
  assert.deepEqual(
    second.meals.map((m) => [m.kind, m.note]),
    [['dinner', 'Ramadan:Sohour']],
  );
  const saved = stripReviewFlags(second);
  assert.ok(!('days' in saved) && !('day' in saved));
});

// End-to-end on the real 6104-mohamed-hesham.pdf (project root); runs when present.
const PDF2 = new URL('../6104-mohamed-hesham.pdf', import.meta.url);
test(
  'regression: 6104-mohamed-hesham.pdf end to end (both day plans)',
  { skip: !fs.existsSync(PDF2) && 'PDF not in project root' },
  async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    const { extractPdfLines } = await import('../src/planParser.js');
    const lines = await extractPdfLines(
      new Uint8Array(fs.readFileSync(PDF2)),
      pdfjs.default ?? pdfjs,
    );
    const shape = (plan) =>
      plan.meals.map((m) => [
        m.kind,
        m.slots.map((s) => [
          s.primary.name,
          s.primary.grams,
          s.alternatives.map((a) => `${a.name} ${a.grams}`),
        ]),
      ]);
    const toast = ['توست بني', 60, ['تورتيلا 50']];
    const foul = ['فول مدمس بالخلطة المصرية', 150, ['فلافل صحيه فى الاير فراير 100']];
    const whey = ['supplements', [['Limitless Alpha Concentrate Whey Protein', 33, []]]];

    const day1 = parseMealSections(lines);
    assert.deepEqual(day1.days, [1, 2]);
    assert.deepEqual(shape(day1), [
      [
        'breakfast',
        [
          toast,
          ['بيض مسلوق كامل', 110, []],
          ['شيدر لايت', 40, ['جبنة الموزاريلا قليلة الدسم 25']],
          ['فلفل اخضر', 100, []],
          ['زيت الزيتون', 5, []],
        ],
      ],
      [
        'snack',
        [
          ['موز', 100, ['بطاطا حلوة مشوية 100', 'بلح - تمر مجفف 30']],
          ['شوكلاتة دارك، 70%-85% كاكاو', 15, []],
        ],
      ],
      [
        'lunch',
        [
          ['أرز بسمتي مسلوق', 150, ['بطاطس مسلوقه 250', 'مكرونة القمح الكامل مطهية 120']],
          [
            'صدر دجاج مشوي - لحم فقط',
            210,
            [
              'بوري المشوي 210',
              'ستيك بقري مشوي 210',
              'كفته مشوية 210',
              'لحم بقرى مشوي بدون دهون 210',
            ],
          ],
          ['سلطة (طماطم وجزر وفلفل وخيار)', 200, []],
          ['زيت الزيتون', 10, []],
          ['زبادي قليل الدسم، جهينة', 180, []],
        ],
      ],
      [
        'dinner',
        [
          toast,
          foul,
          ['جبنة قريش', 50, ['جبنة الموزاريلا قليلة الدسم 25']],
          ['خيار بدون القشرة', 100, []],
          ['تفاح', 150, ['برتقال 180', 'رمان 120', 'فراولة 280', 'موز 100', 'يوسفي 150']],
          ['زبدة فول سوداني غير مملحه', 20, ['فول سوداني 20', 'لوز 20']],
        ],
      ],
      whey,
    ]);
    assert.equal(day1.meals[1].note.split(' — ')[0], 'Before Workout');

    const day2 = parseMealSections(lines, { day: 2 });
    assert.deepEqual(shape(day2), [
      [
        'snack',
        [
          ['تين مجفف', 40, ['بلح - تمر مجفف 40']],
          ['شوكلاتة دارك، 70%-85% كاكاو', 20, []],
        ],
      ],
      [
        'breakfast',
        [
          ['أرز بسمتي مسلوق', 200, ['فريك مطبوخ 150']],
          [
            'صدر دجاج مشوي - لحم فقط',
            190,
            ['بوري المشوي 190', 'لحم بقرى مشوي بدون دهون 190', 'لحم بقري مفروم و مطهي 190'],
          ],
          ['سلطة خضراء مشكلة (جرجير - طماطم - خس - خيار مع القشرة)', 200, []],
          ['زيت الزيتون', 10, []],
        ],
      ],
      [
        'snack',
        [
          ['موز', 100, ['بلح - تمر مجفف 30']],
          ['زبدة فول سوداني', 15, []],
        ],
      ],
      [
        'snack',
        [
          ['بطاطس مسلوقه', 150, ['أرز بسمتي مسلوق 90']],
          ['صدر دجاج مشوي - لحم فقط', 80, []],
        ],
      ],
      [
        'dinner',
        [
          toast,
          foul,
          ['بيض مسلوق كامل', 110, []],
          ['شيدر لايت', 40, ['جبنة قريش 60']],
          ['خيار بدون القشرة', 100, []],
          ['زيت الزيتون', 5, []],
        ],
      ],
      whey,
    ]);
    // Fonts settle every primary/alternative decision in this PDF: nothing is flagged.
    assert.ok([...day1.meals, ...day2.meals].every((m) => m.slots.every((s) => !s.review)));
  },
);
