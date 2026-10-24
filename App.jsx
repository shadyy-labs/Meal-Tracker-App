import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  ArrowUpToLine,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  CloudUpload,
  Code2,
  Coffee,
  CornerLeftUp,
  Download,
  FileText,
  Github,
  Languages,
  LoaderCircle,
  Leaf,
  Moon,
  Pencil,
  Pill,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Split,
  ShieldAlert,
  Sun,
  TriangleAlert,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import {
  MEAL_TYPES,
  applySupplementChoice,
  makeMeal,
  makeOption,
  makeSlot,
  parseMealSections,
  parseNutritionPdf,
  stripReviewFlags,
  uid,
} from './src/planParser.js';

/**
 * PDF Meal Plan Extractor / Daily Tracker
 * Install: npm i lucide-react
 * Styling: Tailwind CSS must be configured in the host Vite project.
 * PDF.js is injected from the CDN only when a PDF is first uploaded; extraction and
 * Arabic text repair live in src/planParser.js.
 * All plan and day data stays in this browser's localStorage.
 */
const PLAN_KEY = 'persistent_nutrition_plan';
const DAY_PREFIX = 'daily_logs_';
const SETTINGS_KEY = 'meal_tracker_settings';
// Reserved key in a day's log: whether supplements (whey) are taken that day.
const SUPPLEMENTS_LOG_KEY = '$supplements';
const clamp = (v, low, high) => Math.min(high, Math.max(low, Number.isFinite(+v) ? +v : low));
const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const moveDay = (date, amount) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + amount);
  return dateKey(d);
};
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function validatePlan(plan) {
  return !!(
    plan?.meals?.length &&
    plan.meals.some((m) => m.slots?.some((s) => s.primary?.name?.trim() && +s.primary.grams > 0))
  );
}
function itemFor(slot, entry) {
  return (
    [slot.primary, ...(slot.alternatives || [])].find((o) => o.id === entry?.optionId) ||
    slot.primary
  );
}
function entryFor(logs, slot) {
  return logs[slot.id] || { optionId: slot.primary.id, eaten: 0 };
}
const translations = {
  ar: {
    app: 'متتبع الخطة الغذائية',
    subtitle: 'خطة ثابتة • متابعة يومية دقيقة',
    today: 'اليوم',
    meals: 'الوجبات',
    remaining: 'المتبقي من الطعام',
    remainingHelp: 'الكميات المتبقية من اختيارات اليوم',
    allDone: 'تناولت جميع الكميات المحددة لهذا اليوم!',
    eatAll: 'تسجيل تناول كل المتبقي',
    upload: 'استيراد خطة PDF',
    replace: 'استبدال الخطة',
    removePlan: 'حذف الخطة',
    welcome: 'مرحبًا بك في متتبع الخطة الغذائية',
    welcomeText:
      'استورد خطتك الغذائية مرة واحدة، ثم سجّل ما تتناوله يوميًا بالجرام وتابع ما تبقى من كل وجبة.',
    getStarted: 'ابدأ باستيراد خطتك',
    featureImport: 'استيراد الخطة',
    featureImportText: 'ارفع ملف PDF أو الصق نص الخطة وراجعه قبل التثبيت.',
    featureLog: 'تسجيل دقيق',
    featureLogText: 'سجّل الكمية التي تناولتها من كل صنف بالجرام.',
    featureLeft: 'المتبقي',
    featureLeftText: 'اعرف كم تبقى من كل صنف ومن كل وجبة.',
    featureAlt: 'البدائل',
    featureAltText: 'اختر بديلًا لأي صنف قبل أن تبدأ في تناوله.',
    plan: 'الخطة الأساسية',
    persist: 'تبقى الخطة كما هي عند تغيير التاريخ',
    eaten: 'المتناول',
    goal: 'الهدف',
    complete: 'مكتمل',
    partial: 'جزئي',
    notStarted: 'لم يبدأ',
    alternatives: 'البدائل',
    left: 'متبقي',
    locked: 'لا يمكن تغيير الاختيار بعد تسجيل كمية منه. أعد الكمية إلى صفر للتبديل.',
    primary: 'الاختيار الأساسي',
    edit: 'تسجيل الكمية',
    grams: 'جرام',
    selected: 'الطعام المختار',
    consumed: 'الكمية التي تناولتها',
    save: 'حفظ',
    markComplete: 'تناولت الكمية كاملة',
    cancel: 'إلغاء',
    close: 'إغلاق',
    add: 'إضافة',
    delete: 'حذف',
    review: 'مراجعة الخطة المستخرجة',
    reviewDescription: 'راجع الأطعمة والأوزان والبدائل قبل تثبيت الخطة.',
    import: 'تثبيت الخطة',
    selectPDF: 'اختر PDF',
    warning:
      'تعذر اكتشاف وجبات واضحة. جرب فصل أسماء الوجبات ووضع الوزن بجانب الصنف، ثم راجع النتائج.',
    confirmAll: 'تسجيل جميع الكميات المتبقية لهذا اليوم كمتناولة؟',
    confirmReset: 'مسح تسجيلات هذا اليوم فقط؟',
    resetDay: 'تصفير اليوم',
    reset: 'تصفير',
    // guide: 'دليل النشر',
    settings: 'الإعدادات',
    dark: 'المظهر الداكن',
    breakfast: 'الفطار',
    lunch: 'الغداء',
    dinner: 'العشاء',
    snack: 'سناك',
    supplements: 'المكملات',
    takeWhey: 'سأتناول الواي بروتين اليوم',
    wheyOn: (g, name) => `تم خصم ${g} جم من ${name} وبدائله مقابل سكوب الواي.`,
    wheyOnNoTarget: 'لم يتم العثور على صدور دجاج لخصم الكمية منها.',
    wheyOff: 'المكملات اختيارية — تم إخفاء بطاقتها لهذا اليوم.',
    wheySwap: (g) => `−${g} جم للواي`,
    mealNote: 'ملاحظة الوجبة',
    planName: 'اسم الخطة',
    addMeal: 'إضافة وجبة',
    addFood: 'إضافة صنف',
    addAlternative: 'إضافة بديل',
    optionName: 'اسم الطعام',
    checkGrouping: 'تحقق: لم يتأكد المستخرج هل هذا صنف أساسي أم بديل.',
    makePrimary: 'اجعله الاختيار الأساسي',
    planDay: 'يوم الخطة',
    dayLabel: 'اليوم',
    splitAlternative: 'افصله كصنف مستقل',
    mergeIntoPrevious: 'اجعله بديلًا للصنف السابق',
    optionWeight: 'الوزن بالجرام',
    noMeals: 'لم يتم العثور على وجبات.',
    pdfWarning: 'يدعم الاستخراج ملفات PDF النصية. لا يمكن قراءة الملفات المصورة (الممسوحة ضوئيًا).',
    local: 'بياناتك محفوظة على هذا الجهاز فقط.',
    previous: 'اليوم السابق',
    next: 'اليوم التالي',
    help: 'مساعدة',
    export: 'تصدير الخطة JSON',
    issues: 'تفاصيل استخراج النص',
    retry: 'إعادة الاستيراد',
    empty: 'لا توجد كميات متبقية',
    total: 'التقدم اليومي',
    items: 'الأصناف',
    resetWarning: 'ستتغير الكميات اليومية فقط؛ لن تتغير خطتك الأساسية.',
    replaceOnly: 'لا يتم تغيير الخطة إلا عند تأكيد الاستبدال.',
    browse: 'اختيار ملف',
    dropTitle: 'اسحب ملف خطتك الغذائية وأفلته هنا',
    dropSubtitle: 'أو اختر ملف PDF من جهازك',
    dropRelease: 'أفلت الملف لبدء الاستخراج',
    tagPdf: 'ملف PDF نصي',
    tagLanguages: 'عربي وإنجليزي',
    tagPrivate: 'تتم المعالجة على جهازك',
    notPdf: 'يرجى اختيار ملف PDF.',
    extracting: 'جاري استخراج خطتك',
    stepRead: 'قراءة صفحات ملف PDF',
    stepText: 'إعادة بناء النص العربي',
    stepMeals: 'تحديد الوجبات والكميات',
    stepAlternatives: 'ربط البدائل بالأصناف',
    cannotExtract: 'تعذر استخراج نص من هذا PDF. قد يكون ممسوحًا ضوئيًا.',
    weekday: 'تاريخ المتابعة',
  },
  en: {
    app: 'Meal Plan Tracker',
    subtitle: 'Fixed plan • precise daily logging',
    today: 'Today',
    meals: 'Meals',
    remaining: 'Remaining foods',
    remainingHelp: 'Amounts left from today’s chosen foods',
    allDone: 'All selected food targets completed today!',
    eatAll: 'Mark all remaining as eaten',
    upload: 'Import PDF plan',
    replace: 'Replace plan',
    removePlan: 'Remove plan',
    welcome: 'Welcome to Meal Plan Tracker',
    welcomeText:
      'Import your nutrition plan once, then log what you eat each day in grams and see exactly what is left of every meal.',
    getStarted: 'Get started — import your plan',
    featureImport: 'Import your plan',
    featureImportText: 'Upload a PDF or paste the plan text, then review it before applying.',
    featureLog: 'Precise logging',
    featureLogText: 'Log the grams you ate for every item.',
    featureLeft: 'Grams left',
    featureLeftText: 'See what remains for each item and each meal.',
    featureAlt: 'Alternatives',
    featureAltText: 'Swap any item for an alternative before you start eating it.',
    plan: 'Master plan',
    persist: 'Plan stays fixed when you change dates',
    eaten: 'Eaten',
    goal: 'Target',
    complete: 'Complete',
    partial: 'Partial',
    notStarted: 'Not started',
    alternatives: 'Alternatives',
    left: 'left',
    locked: 'Choice is locked once you log grams from it. Set eaten back to 0 to switch.',
    primary: 'Primary choice',
    edit: 'Log grams',
    grams: 'g',
    selected: 'Selected food',
    consumed: 'Grams eaten',
    save: 'Save',
    markComplete: 'Mark fully eaten',
    cancel: 'Cancel',
    close: 'Close',
    add: 'Add',
    delete: 'Delete',
    review: 'Review extracted plan',
    reviewDescription: 'Verify foods, gram targets, and alternatives before applying.',
    import: 'Apply plan',
    selectPDF: 'Choose PDF',
    warning:
      'No recognizable meal items found. Try adding explicit meal headings and weights, then review.',
    confirmAll: 'Mark every remaining gram for today as eaten?',
    confirmReset: 'Clear only today’s consumption logs?',
    resetDay: 'Reset today',
    reset: 'Reset',
    reviewDescription2: 'Review before importing',
    // guide: 'Deployment guide',
    settings: 'Settings',
    dark: 'Dark mode',
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    dinner: 'Dinner',
    snack: 'Snack',
    supplements: 'Supplements',
    takeWhey: 'Taking whey protein today',
    wheyOn: (g, name) => `${g} g removed from ${name} and its alternatives for the whey scoop.`,
    wheyOnNoTarget: 'No chicken breast item found to reduce.',
    wheyOff: 'Supplements are optional — their card is hidden for this day.',
    wheySwap: (g) => `−${g} g for whey`,
    mealNote: 'Meal note',
    planName: 'Plan name',
    addMeal: 'Add meal',
    addFood: 'Add food',
    addAlternative: 'Add alternative',
    optionName: 'Food name',
    checkGrouping:
      'Check: the extractor was not sure whether this is a main item or an alternative.',
    makePrimary: 'Make primary choice',
    planDay: 'Plan day',
    dayLabel: 'Day',
    splitAlternative: 'Split into its own item',
    mergeIntoPrevious: 'Make it an alternative of the previous item',
    optionWeight: 'Weight in grams',
    noMeals: 'No meals detected.',
    pdfWarning: 'Text-based PDFs are supported. Scanned or image-only PDFs cannot be read.',
    local: 'Your data stays in this browser.',
    previous: 'Previous day',
    next: 'Next day',
    help: 'Help',
    export: 'Export plan JSON',
    issues: 'Extracted text details',
    retry: 'Import again',
    empty: 'Nothing remains',
    total: 'Daily progress',
    items: 'Items',
    resetWarning: 'Only your daily logs change; the master plan remains fixed.',
    replaceOnly: 'Your plan is changed only after you confirm replacement.',
    browse: 'Choose file',
    dropTitle: 'Drag and drop your nutrition plan',
    dropSubtitle: 'or choose a PDF file from your device',
    dropRelease: 'Release to start extracting',
    tagPdf: 'Text-based PDF',
    tagLanguages: 'Arabic & English',
    tagPrivate: 'Processed on this device',
    notPdf: 'Please choose a PDF file.',
    extracting: 'Extracting your plan',
    stepRead: 'Reading the PDF pages',
    stepText: 'Rebuilding the Arabic text',
    stepMeals: 'Detecting meals and gram targets',
    stepAlternatives: 'Matching alternatives to items',
    cannotExtract: 'No text could be extracted. This PDF may be scanned.',
    weekday: 'Tracking date',
  },
};
const Button = ({ children, variant = 'secondary', className = '', ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${variant === 'primary' ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : variant === 'danger' ? 'bg-rose-500/15 text-rose-500 hover:bg-rose-500/25' : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'} ${className}`}
  >
    {children}
  </button>
);
const Modal = ({ title, onClose, children, wide = false, width }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
    onMouseDown={(e) => e.target === e.currentTarget && onClose()}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={`flex max-h-[94dvh] w-full ${width ?? (wide ? 'max-w-5xl' : 'max-w-lg')} flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900`}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-xl font-bold">{title}</h2>
        <button
          aria-label="Close"
          onClick={onClose}
          className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X size={20} />
        </button>
      </header>
      <div className="overflow-y-auto p-5">{children}</div>
    </div>
  </div>
);
const Field = ({ value, onChange, placeholder, type = 'text', min, className = '', ...props }) => (
  <input
    {...props}
    type={type}
    min={min}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className={`w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white ${className}`}
  />
);
function Progress({ eaten, total }) {
  const ratio = total > 0 ? clamp(eaten / total, 0, 1) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div
        className={`h-full rounded-full transition-all duration-300 ${ratio >= 1 ? 'bg-emerald-500' : ratio > 0 ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
/** Stylised PDF page; `scanning` adds the pulsing lines and the moving scan bar. */
function PdfSheet({ scanning = false }) {
  return (
    <div className="relative h-28 w-22 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-white/5 p-3">
      <div className="mb-3 h-2 w-2/3 rounded-full bg-emerald-400/70" />
      {[100, 85, 95, 70, 90, 60].map((w, i) => (
        <div
          key={i}
          className={`mb-2 h-1.5 rounded-full bg-white/25 ${scanning ? 'motion-safe:animate-pulse' : ''}`}
          style={{ width: `${w}%`, animationDelay: `${i * 150}ms` }}
        />
      ))}
      {scanning && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-emerald-400/45 to-transparent motion-safe:animate-[pdf-scan_1.8s_ease-in-out_infinite]" />
      )}
    </div>
  );
}
/** Import entry point: drop a PDF on the card or pick one with the button. */
function ImportDropzone({ t, onPick, onFile }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-2 text-white shadow-xl motion-safe:animate-[fade-in_300ms_ease-out]"
    >
      <div
        className={`flex min-h-60 flex-col items-center justify-center gap-5 rounded-xl border-2 border-dashed px-5 py-7 text-center transition-colors duration-200 ${over ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/15'}`}
      >
        <div
          className={`relative transition-transform duration-300 ${over ? 'scale-110' : 'motion-safe:animate-[pdf-float_3s_ease-in-out_infinite]'}`}
        >
          <PdfSheet />
          <span className="absolute -bottom-2 -end-2 rounded-full bg-emerald-500 p-1.5 text-slate-950 shadow-lg ring-4 ring-slate-900">
            <CloudUpload size={16} />
          </span>
        </div>
        <div>
          <p className="text-lg font-extrabold">{over ? t.dropRelease : t.dropTitle}</p>
          <p className="mt-1 text-sm text-slate-400">{t.dropSubtitle}</p>
        </div>
        <Button variant="primary" onClick={onPick}>
          <CloudUpload size={18} />
          {t.browse}
        </Button>
        <ul className="flex flex-wrap justify-center gap-2 text-xs text-slate-300">
          {[
            [FileText, t.tagPdf],
            [Languages, t.tagLanguages],
            [ShieldCheck, t.tagPrivate],
          ].map(([Icon, label]) => (
            <li
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1"
            >
              <Icon size={13} className="text-emerald-300" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
// Shown while a PDF is being extracted. Steps advance on a timer and the import
// waits at least EXTRACTION_MIN_MS, so the sequence is visible even for fast files.
const EXTRACTION_STEPS = ['stepRead', 'stepText', 'stepMeals', 'stepAlternatives'];
const EXTRACTION_STEP_MS = 850;
const EXTRACTION_MIN_MS = EXTRACTION_STEP_MS * EXTRACTION_STEPS.length + 400;
function ExtractionProgress({ t, fileName }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, EXTRACTION_STEPS.length - 1)),
      EXTRACTION_STEP_MS,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-64 items-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-5 text-white shadow-xl motion-safe:animate-[fade-in_300ms_ease-out] sm:p-6"
    >
      <div className="flex w-full flex-col items-center gap-6 sm:flex-row sm:items-center">
        <PdfSheet scanning />
        <div className="w-full min-w-0 flex-1">
          <p className="text-lg font-extrabold">{t.extracting}</p>
          <p dir="auto" className="truncate text-xs text-slate-400">
            {fileName}
          </p>
          <ol className="mt-4 space-y-2.5">
            {EXTRACTION_STEPS.map((key, i) => (
              <li
                key={key}
                className={`flex items-center gap-2.5 text-sm transition-colors duration-300 ${i < step ? 'text-emerald-300' : i === step ? 'text-white' : 'text-slate-500'}`}
              >
                {i < step ? (
                  <Check size={16} />
                ) : i === step ? (
                  <LoaderCircle size={16} className="motion-safe:animate-spin" />
                ) : (
                  <span className="mx-1.5 h-1.5 w-1.5 rounded-full bg-current" />
                )}
                {t[key]}
              </li>
            ))}
          </ol>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-700 ease-out"
              style={{ width: `${((step + 1) / EXTRACTION_STEPS.length) * 92}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
function MealEditor({ draft, setDraft, t }) {
  const update = (updater) =>
    setDraft((old) => {
      const copy = structuredClone(old);
      updater(copy);
      return copy;
    });
  return (
    <div className="space-y-5">
      <label className="block space-y-1 text-sm font-semibold">
        {t.planName}
        <Field
          value={draft.name}
          onChange={(v) =>
            update((p) => {
              p.name = v;
            })
          }
        />
      </label>
      {draft.meals.map((meal, mi) => (
        <div
          key={meal.id}
          className="space-y-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-700"
        >
          <div className="flex gap-2">
            <select
              aria-label="Meal category"
              value={meal.kind}
              onChange={(e) =>
                update((p) => {
                  p.meals[mi].kind = e.target.value;
                })
              }
              className="flex-1 rounded-xl bg-slate-100 px-2 py-2 font-bold dark:bg-slate-800"
            >
              {MEAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t[type]}
                </option>
              ))}
            </select>
            <Button
              variant="danger"
              aria-label={t.delete}
              onClick={() => update((p) => p.meals.splice(mi, 1))}
            >
              <Trash2 size={16} />
            </Button>
          </div>
          <Field
            placeholder={t.mealNote}
            value={meal.note || ''}
            onChange={(v) =>
              update((p) => {
                p.meals[mi].note = v;
              })
            }
          />
          {meal.slots.map((slot, si) => (
            <div
              key={slot.id}
              className={`rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60 ${slot.review ? 'ring-1 ring-amber-500/60' : ''}`}
            >
              {slot.review && (
                <p className="mb-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <TriangleAlert size={14} />
                  {t.checkGrouping}
                </p>
              )}
              <div className="flex items-center gap-2">
                <div className="flex-[3]">
                  <Field
                    placeholder={t.optionName}
                    value={slot.primary.name}
                    onChange={(v) =>
                      update((p) => {
                        p.meals[mi].slots[si].primary.name = v;
                      })
                    }
                  />
                </div>
                <div className="w-24">
                  <Field
                    type="number"
                    min="0"
                    value={slot.primary.grams}
                    onChange={(v) =>
                      update((p) => {
                        p.meals[mi].slots[si].primary.grams = clamp(v, 0, 99999);
                      })
                    }
                  />
                </div>
                {si > 0 && (
                  <button
                    aria-label={t.mergeIntoPrevious}
                    title={t.mergeIntoPrevious}
                    className="text-slate-400 hover:text-emerald-500"
                    onClick={() =>
                      update((p) => {
                        const [moved] = p.meals[mi].slots.splice(si, 1);
                        const target = p.meals[mi].slots[si - 1];
                        target.alternatives.push(moved.primary, ...moved.alternatives);
                        delete target.review;
                      })
                    }
                  >
                    <CornerLeftUp size={17} />
                  </button>
                )}
                <button
                  aria-label={t.delete}
                  className="text-rose-500"
                  onClick={() => update((p) => p.meals[mi].slots.splice(si, 1))}
                >
                  <Trash2 size={17} />
                </button>
              </div>
              {slot.alternatives.map((alt, ai) => (
                <div key={alt.id} className="mt-2 flex items-center gap-2 ps-3">
                  <span className="hidden text-xs text-slate-400 sm:block">↳</span>
                  <div className="flex-[3]">
                    <Field
                      placeholder={t.alternatives}
                      value={alt.name}
                      onChange={(v) =>
                        update((p) => {
                          p.meals[mi].slots[si].alternatives[ai].name = v;
                        })
                      }
                    />
                  </div>
                  <div className="w-24">
                    <Field
                      type="number"
                      min="0"
                      value={alt.grams}
                      onChange={(v) =>
                        update((p) => {
                          p.meals[mi].slots[si].alternatives[ai].grams = clamp(v, 0, 99999);
                        })
                      }
                    />
                  </div>
                  <button
                    aria-label={t.makePrimary}
                    title={t.makePrimary}
                    className="text-slate-400 hover:text-emerald-500"
                    onClick={() =>
                      update((p) => {
                        const s = p.meals[mi].slots[si];
                        [s.primary, s.alternatives[ai]] = [s.alternatives[ai], s.primary];
                      })
                    }
                  >
                    <ArrowUpToLine size={17} />
                  </button>
                  <button
                    aria-label={t.splitAlternative}
                    title={t.splitAlternative}
                    className="text-slate-400 hover:text-emerald-500"
                    onClick={() =>
                      update((p) => {
                        const s = p.meals[mi].slots[si];
                        const [alt] = s.alternatives.splice(ai, 1);
                        delete s.review;
                        p.meals[mi].slots.splice(si + 1, 0, {
                          id: uid(),
                          primary: alt,
                          alternatives: [],
                        });
                      })
                    }
                  >
                    <Split size={17} />
                  </button>
                  <button
                    aria-label={t.delete}
                    className="text-rose-500"
                    onClick={() => update((p) => p.meals[mi].slots[si].alternatives.splice(ai, 1))}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  update((p) => p.meals[mi].slots[si].alternatives.push(makeOption('', 0)))
                }
                className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
              >
                <Plus size={14} />
                {t.addAlternative}
              </button>
            </div>
          ))}
          <Button
            className="w-full"
            onClick={() => update((p) => p.meals[mi].slots.push(makeSlot('', 0)))}
          >
            <Plus size={16} />
            {t.addFood}
          </Button>
        </div>
      ))}
      <Button onClick={() => update((p) => p.meals.push(makeMeal('snack')))}>
        <Plus size={16} />
        {t.addMeal}
      </Button>
    </div>
  );
}

// function DeploymentGuide({ lang }) { return lang === 'ar' ? <div className="space-y-5 text-sm leading-7"><p>هذه واجهة React ذات ملف واحد، لكنها تحتاج مشروع Vite مع Tailwind و lucide-react. يمكن تشغيلها على GitHub Pages أو Vercel أو Netlify.</p><div><b>1. إنشاء مشروع React</b><pre dir="ltr" className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-left text-emerald-300">npm create vite@latest meal-tracker -- --template react{'\n'}cd meal-tracker{'\n'}npm install{'\n'}npm install lucide-react tailwindcss @tailwindcss/vite</pre></div><div><b>2. ضبط Tailwind</b><p>أضف استيراد <code>@import "tailwindcss";</code> إلى <code>src/index.css</code>، وفعّل إضافة <code>@tailwindcss/vite</code> في <code>vite.config.js</code> عبر <code>plugins: [react(), tailwindcss()]</code> مع استيراد <code>tailwindcss from '@tailwindcss/vite'</code>. أضف <code>@custom-variant dark (&:where(.dark, .dark *));</code> في <code>src/index.css</code>.</p></div><div><b>3. نسخ التطبيق</b><p>ضع هذا الملف داخل <code>src/App.jsx</code> ثم شغّل <code>npm run dev</code>.</p></div><div><b>4. النشر</b><p><b>Vercel / Netlify:</b> ارفع المشروع إلى GitHub، اربطه بالمنصة، واستخدم Build command <code>npm run build</code> و Output <code>dist</code>.</p><p><b>GitHub Pages:</b> ثبّت <code>gh-pages</code>، واضبط <code>base: '/YOUR_REPO/'</code> في إعدادات Vite، ثم انشر مجلد <code>dist</code> عبر GitHub Actions أو gh-pages.</p></div><p className="text-amber-600">تنبيه: بيانات localStorage لا تتزامن بين الأجهزة، وتمسح عند حذف بيانات الموقع. واستخراج PDF يحتاج إنترنت لتحميل PDF.js من CDN.</p></div> : <div className="space-y-5 text-sm leading-7"><p>This single-file React app runs inside a Vite + Tailwind project.</p><div><b>1. Create project</b><pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-emerald-300">npm create vite@latest meal-tracker -- --template react{'\n'}cd meal-tracker{'\n'}npm install{'\n'}npm install lucide-react tailwindcss @tailwindcss/vite</pre></div><div><b>2. Enable Tailwind</b><p>Add <code>import tailwindcss from '@tailwindcss/vite'</code> and <code>tailwindcss()</code> to your Vite plugins next to <code>react()</code>. In <code>src/index.css</code>, add <code>@import "tailwindcss";</code> followed by <code>@custom-variant dark (&:where(.dark, .dark *));</code>.</p></div><div><b>3. Add app</b><p>Replace <code>src/App.jsx</code> with this file, then run <code>npm run dev</code>.</p></div><div><b>4. Deploy</b><p>Push to GitHub and import the repository into <b>Vercel</b> or <b>Netlify</b>. Use build command <code>npm run build</code> and publish directory <code>dist</code>.</p><p>For <b>GitHub Pages</b>, set Vite <code>base: '/YOUR_REPO/'</code> and publish the <code>dist</code> directory with GitHub Actions or the gh-pages package.</p></div><p className="text-amber-600">LocalStorage is device/browser-specific; there is no cloud sync. PDF.js loads from CDN and requires a network connection.</p></div>; }

export default function App() {
  const [prefs, setPrefs] = useState(() => readJSON(SETTINGS_KEY, { lang: 'en', dark: true }));
  const lang = prefs.lang === 'ar' ? 'ar' : 'en';
  const t = translations[lang];
  const [plan, setPlan] = useState(() => readJSON(PLAN_KEY, null));
  const [day, setDay] = useState(() => dateKey(new Date()));
  const [log, setLog] = useState(() => readJSON(DAY_PREFIX + dateKey(new Date()), {}));
  const [modal, setModal] = useState(null); // import, review, log
  const [draft, setDraft] = useState(null);
  const [rawExtracted, setRawExtracted] = useState('');
  const [reparse, setReparse] = useState(null); // re-parses the source for another day plan
  const [busy, setBusy] = useState(''); // name of the PDF being extracted
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs));
    document.documentElement.classList.toggle('dark', !!prefs.dark);
  }, [prefs]);
  useEffect(() => {
    setLog(readJSON(DAY_PREFIX + day, {}));
  }, [day]);
  const commitLog = (updater) =>
    setLog((old) => {
      const next = typeof updater === 'function' ? updater(old) : updater;
      localStorage.setItem(DAY_PREFIX + day, JSON.stringify(next));
      return next;
    });
  const takeSupplements = log[SUPPLEMENTS_LOG_KEY] ?? !!prefs.supplements;
  const {
    plan: dayPlan,
    hasSupplements,
    swap,
  } = useMemo(() => applySupplementChoice(plan, takeSupplements), [plan, takeSupplements]);
  const setSupplements = (take) => {
    commitLog((old) => ({ ...old, [SUPPLEMENTS_LOG_KEY]: take }));
    setPrefs((p) => ({ ...p, supplements: take }));
  };
  const rows = useMemo(
    () =>
      (dayPlan?.meals || []).flatMap((meal, mi) =>
        (meal.slots || []).map((slot) => {
          const entry = entryFor(log, slot),
            option = itemFor(slot, entry);
          return {
            meal,
            mi,
            slot,
            entry,
            option,
            goal: +option.grams || 0,
            eaten: clamp(entry.eaten, 0, +option.grams || 0),
          };
        }),
      ),
    [dayPlan, log],
  );
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          goal: acc.goal + row.goal,
          eaten: acc.eaten + row.eaten,
          completed: acc.completed + (row.goal > 0 && row.eaten >= row.goal ? 1 : 0),
        }),
        { goal: 0, eaten: 0, completed: 0 },
      ),
    [rows],
  );
  const remaining = rows.filter((r) => r.goal - r.eaten > 0);
  const number = (n) =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 1 }).format(
      n,
    );
  const displayDate = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${day}T12:00:00`));
  const ask = (message) => window.confirm(message);
  const clearDailyLogs = () => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(DAY_PREFIX)) localStorage.removeItem(key);
    }
  };
  const removePlan = () => {
    clearDailyLogs();
    localStorage.removeItem(PLAN_KEY);
    setPlan(null);
    setLog({});
    setModal(null);
    setError('');
  };
  const replacePlan = (value) => {
    if (!validatePlan(value)) {
      setError(t.warning);
      return;
    }
    if (plan) clearDailyLogs();
    const clean = stripReviewFlags(value);
    localStorage.setItem(PLAN_KEY, JSON.stringify(clean));
    setPlan(clean);
    setLog({});
    setModal(null);
    setError('');
  };
  const preview = (value) => {
    if (!value.meals?.length) {
      setError(t.warning);
      return;
    }
    setDraft(value);
    setError('');
    setModal('review');
  };
  const fromFile = async (file) => {
    if (busy) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setError(t.notPdf);
      return;
    }
    setBusy(file.name);
    setError('');
    try {
      const started = Date.now();
      const { text: raw, lines, plan: value } = await parseNutritionPdf(file);
      // Let the extraction animation play through before the review opens.
      await new Promise((r) =>
        setTimeout(r, Math.max(0, EXTRACTION_MIN_MS - (Date.now() - started))),
      );
      setRawExtracted(raw);
      if (!raw.trim()) throw new Error(t.cannotExtract);
      const name = file.name.replace(/\.pdf$/i, '');
      value.name = name;
      setReparse(() => (day) => ({ ...parseMealSections(lines, { day }), name }));
      preview(value);
    } catch (err) {
      setError(`${err.message}. ${t.pdfWarning}`);
      setModal('import');
    } finally {
      setBusy('');
    }
  };
  const openEntry = (row) => {
    setEditing({ slotId: row.slot.id, optionId: row.option.id, eaten: row.eaten });
    setModal('log');
  };
  const saveEntry = () => {
    const slot = rows.find((r) => r.slot.id === editing?.slotId)?.slot;
    if (!slot) return;
    const opt =
      [slot.primary, ...slot.alternatives].find((o) => o.id === editing.optionId) || slot.primary;
    commitLog((old) => ({
      ...old,
      [slot.id]: { optionId: opt.id, eaten: clamp(editing.eaten, 0, opt.grams) },
    }));
    setModal(null);
  };
  const chooseOption = (slot, optionId) =>
    commitLog((old) =>
      entryFor(old, slot).eaten > 0 ? old : { ...old, [slot.id]: { optionId, eaten: 0 } },
    );
  const eatRemaining = () => {
    if (!ask(t.confirmAll)) return;
    commitLog((old) => {
      const next = { ...old };
      rows.forEach((r) => {
        next[r.slot.id] = { optionId: r.option.id, eaten: r.goal };
      });
      return next;
    });
  };
  const exportPlan = () => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nutrition-plan.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-dvh bg-slate-50 font-sans text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-5 sm:px-6">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-500 p-3 text-slate-950">
              <UtensilsCrossed size={25} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{t.app}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.subtitle}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setPrefs((p) => ({ ...p, lang: lang === 'ar' ? 'en' : 'ar' }))}>
              <Languages size={17} />
              {lang === 'ar' ? 'English' : 'العربية'}
            </Button>
            <Button aria-label={t.dark} onClick={() => setPrefs((p) => ({ ...p, dark: !p.dark }))}>
              {prefs.dark ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
          </div>
        </header>
        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start justify-between gap-3 rounded-2xl bg-rose-100 p-4 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
          >
            <span>{error}</span>
            <button onClick={() => setError('')}>
              <X size={18} />
            </button>
          </div>
        )}
        {!plan ? (
          <section className="mx-auto mt-10 max-w-4xl">
            <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-center text-white shadow-xl sm:p-12">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500 text-slate-950">
                <UtensilsCrossed size={32} />
              </div>
              <h2 className="mb-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                {t.welcome}
              </h2>
              <p className="mx-auto mb-8 max-w-2xl text-slate-300">{t.welcomeText}</p>
              <Button variant="primary" onClick={() => setModal('import')}>
                <CloudUpload size={18} />
                {t.getStarted}
              </Button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [FileText, t.featureImport, t.featureImportText],
                [Pencil, t.featureLog, t.featureLogText],
                [Leaf, t.featureLeft, t.featureLeftText],
                [ArrowLeftRight, t.featureAlt, t.featureAltText],
              ].map(([Icon, title, text]) => (
                <div
                  key={title}
                  className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
                    <Icon size={20} />
                  </div>
                  <h3 className="mb-1 font-bold">{title}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <>
            {hasSupplements && (
              <section className="mb-4 flex items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${takeSupplements ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}
                  >
                    <Pill size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold">{t.takeWhey}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {!takeSupplements
                        ? t.wheyOff
                        : swap
                          ? t.wheyOn(number(swap.grams), swap.name)
                          : t.wheyOnNoTarget}
                    </p>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={takeSupplements}
                  aria-label={t.takeWhey}
                  onClick={() => setSupplements(!takeSupplements)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${takeSupplements ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${takeSupplements ? 'start-6' : 'start-1'}`}
                  />
                </button>
              </section>
            )}
            <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-5 text-white shadow-xl sm:p-7">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-emerald-300">{t.plan}</p>
                    <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">{plan.name}</h2>
                    <p className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                      <Check size={14} />
                      {t.persist}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setModal('import')}>
                      <ArrowLeftRight size={16} />
                      {t.replace}
                    </Button>
                    <Button variant="danger" onClick={removePlan}>
                      <Trash2 size={16} />
                      {t.removePlan}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-white/10 p-4">
                    <div className="text-xs text-slate-300">{t.total}</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-300">
                      {totals.goal ? Math.round((totals.eaten / totals.goal) * 100) : 0}%
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-4">
                    <div className="text-xs text-slate-300">{t.eaten}</div>
                    <div className="mt-1 text-2xl font-bold">
                      {number(totals.eaten)} <span className="text-sm">{t.grams}</span>
                    </div>
                  </div>
                  <div className="col-span-2 rounded-2xl bg-white/10 p-4 sm:col-span-1">
                    <div className="text-xs text-slate-300">{t.complete}</div>
                    <div className="mt-1 text-2xl font-bold">
                      {number(totals.completed)} / {number(rows.length)}
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <Progress eaten={totals.eaten} total={totals.goal} />
                </div>
              </div>
              <div className="flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <p className="mb-2 flex items-center gap-2 text-sm font-bold">
                    <CalendarDays size={18} className="text-emerald-500" />
                    {t.weekday}
                  </p>
                  <p className="mb-4 text-lg font-semibold">{displayDate}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    aria-label={t.previous}
                    className="flex-1"
                    onClick={() => setDay((d) => moveDay(d, -1))}
                  >
                    {lang === 'ar' ? <ChevronRight size={19} /> : <ChevronLeft size={19} />}
                  </Button>
                  <Button className="flex-[3]" onClick={() => setDay(dateKey(new Date()))}>
                    {t.today}
                  </Button>
                  <Button
                    aria-label={t.next}
                    className="flex-1"
                    onClick={() => setDay((d) => moveDay(d, 1))}
                  >
                    {lang === 'ar' ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}
                  </Button>
                </div>
                <input
                  aria-label={t.weekday}
                  dir="ltr"
                  type="date"
                  value={day}
                  onChange={(e) => e.target.value && setDay(e.target.value)}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-transparent p-2 dark:border-slate-700"
                />
                <Button
                  variant="danger"
                  className="mt-3"
                  onClick={() => {
                    if (ask(t.confirmReset))
                      commitLog((old) =>
                        SUPPLEMENTS_LOG_KEY in old
                          ? { [SUPPLEMENTS_LOG_KEY]: old[SUPPLEMENTS_LOG_KEY] }
                          : {},
                      );
                  }}
                >
                  <RotateCcw size={15} />
                  {t.resetDay}
                </Button>
              </div>
            </section>
            <div className="mb-4 flex items-center gap-2">
              <Activity className="text-emerald-500" size={21} />
              <h2 className="text-xl font-bold">{t.meals}</h2>
            </div>
            <div className="grid gap-5">
              {dayPlan.meals.map((meal, mi) => {
                const mealRows = rows.filter((r) => r.meal.id === meal.id);
                const mealGoal = mealRows.reduce((sum, r) => sum + r.goal, 0),
                  mealEaten = mealRows.reduce((sum, r) => sum + r.eaten, 0);
                return (
                  <article
                    key={meal.id}
                    className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="bg-slate-100 px-5 py-4 dark:bg-slate-800/70">
                      <div className="flex items-center justify-between">
                        <h3 className="font-extrabold">
                          {t[meal.kind] || meal.kind}
                          {dayPlan.meals.filter((m) => m.kind === meal.kind).length > 1
                            ? ` · ${dayPlan.meals.slice(0, mi + 1).filter((m) => m.kind === meal.kind).length}`
                            : ''}
                        </h3>
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                          {number(mealEaten)} / {number(mealGoal)} {t.grams}
                        </span>
                      </div>
                      {meal.note && (
                        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-300">
                          {meal.note}
                        </p>
                      )}
                      <div className="mt-3">
                        <Progress eaten={mealEaten} total={mealGoal} />
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
                      {mealRows.map((row) => {
                        const done = row.goal > 0 && row.eaten >= row.goal,
                          partial = row.eaten > 0 && !done;
                        return (
                          <div key={row.slot.id} className="py-4">
                            <div className="flex items-start gap-3">
                              <button
                                onClick={() => openEntry(row)}
                                aria-label={t.edit}
                                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${done ? 'bg-emerald-500/15 text-emerald-500' : partial ? 'bg-indigo-500/15 text-indigo-500' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}
                              >
                                {done ? <CheckCheck size={19} /> : <Pencil size={17} />}
                              </button>
                              <div className="min-w-0 flex-1">
                                <button
                                  className={`text-start font-bold ${done ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
                                  onClick={() => openEntry(row)}
                                >
                                  {row.option.name}
                                </button>
                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  {number(row.eaten)} / {number(row.goal)} {t.grams} ·{' '}
                                  <span
                                    className={
                                      done ? 'text-emerald-500' : partial ? 'text-indigo-500' : ''
                                    }
                                  >
                                    {done ? t.complete : partial ? t.partial : t.notStarted}
                                  </span>
                                  {swap?.slotId === row.slot.id && (
                                    <span className="ms-2 rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                                      {t.wheySwap(number(swap.grams))}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-2">
                                  <Progress eaten={row.eaten} total={row.goal} />
                                </div>
                                {row.slot.alternatives?.length > 0 && (
                                  <select
                                    aria-label={t.alternatives}
                                    title={row.eaten > 0 ? t.locked : undefined}
                                    disabled={row.eaten > 0}
                                    value={row.option.id}
                                    onChange={(e) => chooseOption(row.slot, e.target.value)}
                                    className="mt-3 max-w-full rounded-lg border disabled:cursor-not-allowed disabled:opacity-60 border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                                  >
                                    <option value={row.slot.primary.id}>
                                      {t.primary}: {row.slot.primary.name} (
                                      {number(row.slot.primary.grams)} {t.grams})
                                    </option>
                                    {row.slot.alternatives.map((alt) => (
                                      <option value={alt.id} key={alt.id}>
                                        {alt.name} ({number(alt.grams)} {t.grams})
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                              <div
                                className={`shrink-0 rounded-xl px-3 py-1.5 text-center ${done ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
                              >
                                <div className="text-lg font-extrabold leading-tight">
                                  {number(row.goal - row.eaten)}{' '}
                                  <span className="text-xs font-semibold">{t.grams}</span>
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {t.left}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
            <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-extrabold">
                    <Leaf size={22} className="text-emerald-500" />
                    {t.remaining}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {t.remainingHelp}
                  </p>
                </div>
                {remaining.length > 0 && (
                  <Button variant="primary" onClick={eatRemaining}>
                    <CheckCheck size={17} />
                    {t.eatAll}
                  </Button>
                )}
              </div>
              {remaining.length === 0 ? (
                <div className="rounded-2xl bg-emerald-500/10 p-8 text-center font-semibold text-emerald-600 dark:text-emerald-300">
                  <CheckCheck size={30} className="mx-auto mb-3" />
                  {t.allDone}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {remaining.map((row) => (
                    <button
                      onClick={() => openEntry(row)}
                      key={row.slot.id}
                      className="rounded-2xl border border-slate-200 p-4 text-start transition hover:border-emerald-500 dark:border-slate-700"
                    >
                      <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                        {t[row.meal.kind]}
                      </p>
                      <p className="font-bold">{row.option.name}</p>
                      <div className="mt-2 text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                        {number(row.goal - row.eaten)} <span className="text-sm">{t.grams}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
            {plan.notes && (
              <p className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs leading-6 text-amber-800 dark:text-amber-200">
                {plan.notes}
              </p>
            )}
          </>
        )}
        <footer className="mt-10 text-center text-xs text-slate-500">{t.local}</footer>
      </div>
      {modal === 'import' && (
        <Modal title={plan ? t.replace : t.upload} onClose={() => setModal(null)} width="max-w-2xl">
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) fromFile(file);
              }}
              className="hidden"
            />
            {busy ? (
              <ExtractionProgress t={t} fileName={busy} />
            ) : (
              <ImportDropzone t={t} onPick={() => fileRef.current?.click()} onFile={fromFile} />
            )}
            {error && !busy && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300"
              >
                <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
            <p className="flex items-start gap-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                {t.pdfWarning} {plan && t.replaceOnly}
              </span>
            </p>
          </div>
        </Modal>
      )}
      {modal === 'review' && draft && (
        <Modal title={t.review} onClose={() => setModal(null)} wide>
          <div className="space-y-5">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t.reviewDescription}</p>
            {draft.days?.length > 1 && reparse && (
              <label className="flex items-center gap-2 text-sm font-semibold">
                {t.planDay}
                <select
                  value={draft.day}
                  onChange={(e) =>
                    setDraft({ ...reparse(Number(e.target.value)), name: draft.name })
                  }
                  className="rounded-xl bg-slate-100 px-2 py-2 font-bold dark:bg-slate-800"
                >
                  {draft.days.map((d) => (
                    <option key={d} value={d}>
                      {t.dayLabel} {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <MealEditor draft={draft} setDraft={setDraft} t={t} />
            {rawExtracted && (
              <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <summary className="cursor-pointer font-semibold">{t.issues}</summary>
                <pre dir="auto" className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap text-xs">
                  {rawExtracted}
                </pre>
              </details>
            )}
            <div className="sticky bottom-0 flex justify-end gap-3 bg-white py-3 dark:bg-slate-900">
              <Button onClick={() => setModal(null)}>{t.cancel}</Button>
              <Button
                variant="primary"
                disabled={
                  !validatePlan(draft) ||
                  draft.meals.some((m) =>
                    m.slots?.some(
                      (s) =>
                        !s.primary.name.trim() ||
                        s.primary.grams <= 0 ||
                        s.alternatives.some((a) => !a.name.trim() || a.grams <= 0),
                    ),
                  )
                }
                onClick={() => replacePlan(draft)}
              >
                <Save size={17} />
                {t.import}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'log' &&
        editing &&
        (() => {
          const row = rows.find((r) => r.slot.id === editing.slotId);
          if (!row) return null;
          const opt =
            [row.slot.primary, ...row.slot.alternatives].find((o) => o.id === editing.optionId) ||
            row.slot.primary;
          return (
            <Modal title={t.edit} onClose={() => setModal(null)}>
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="font-semibold">{t.selected}</label>
                  <select
                    disabled={row.eaten > 0}
                    value={editing.optionId}
                    onChange={(e) =>
                      setEditing((old) => ({ ...old, optionId: e.target.value, eaten: 0 }))
                    }
                    className="w-full rounded-xl border disabled:cursor-not-allowed disabled:opacity-60 border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value={row.slot.primary.id}>
                      {row.slot.primary.name} — {number(row.slot.primary.grams)} {t.grams}
                    </option>
                    {row.slot.alternatives.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — {number(a.grams)} {t.grams}
                      </option>
                    ))}
                  </select>
                  {row.eaten > 0 && row.slot.alternatives.length > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">{t.locked}</p>
                  )}
                </div>
                <div>
                  <label className="mb-2 block font-semibold">
                    {t.consumed} ({t.grams})
                  </label>
                  <Field
                    type="number"
                    min="0"
                    max={opt.grams}
                    value={editing.eaten}
                    onFocus={(e) => e.target.select()}
                    onChange={(v) =>
                      // Keep '' while typing so the field can be cleared; saveEntry clamps it to 0.
                      setEditing((old) => ({ ...old, eaten: v === '' ? '' : clamp(v, 0, opt.grams) }))
                    }
                  />
                  <input
                    aria-label={t.consumed}
                    className="mt-5 w-full accent-emerald-500"
                    type="range"
                    min="0"
                    max={opt.grams}
                    step={1}
                    value={+editing.eaten || 0}
                    onChange={(e) => setEditing((old) => ({ ...old, eaten: +e.target.value }))}
                  />
                  <div className="mt-3 flex justify-between text-sm text-slate-500">
                    <span>
                      {number(+editing.eaten || 0)} {t.grams}
                    </span>
                    <span>
                      {number(opt.grams)} {t.grams}
                    </span>
                  </div>
                  <div className="mt-3">
                    <Progress eaten={+editing.eaten || 0} total={opt.grams} />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => setEditing((old) => ({ ...old, eaten: opt.grams }))}
                >
                  <CheckCheck size={17} />
                  {t.markComplete}
                </Button>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setModal(null)}>{t.cancel}</Button>
                  <Button variant="primary" onClick={saveEntry}>
                    <Save size={17} />
                    {t.save}
                  </Button>
                </div>
              </div>
            </Modal>
          );
        })()}
      {/*{modal === 'guide' && <Modal title={t.guide} onClose={() => setModal(null)} wide><DeploymentGuide lang={lang}/></Modal>}*/}
    </div>
  );
}
