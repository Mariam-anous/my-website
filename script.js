/* =========================================================
   1) مصدر الاقتباسات غير المحدود
   قاعدة بيانات عامة (Hugging Face datasets-server) فيها
   أكثر من 5900 اقتباس عربي حقيقي. بنجيب دفعة عشوائية في كل
   مرة ونخزنها مؤقتاً، وإذا فشل الاتصال بالنت منرجع لمجموعة
   محلية صغيرة كخطة بديلة.
   ========================================================= */
const DATASET = "AhmedBou/Arabic_Quotes";
const DATASET_TOTAL_ROWS = 5964;
const BATCH_SIZE = 40;

const CATEGORY_KEYWORDS = {
  life: ["حياة", "عيش"],
  success: ["نجاح", "طموح", "تحفيز", "تميز"],
  love: ["حب", "رومانس", "علاقات", "عاطف"],
  wisdom: ["حكمة", "تأمل", "نصائح", "فلسفة", "تفكير", "اخلاق"],
};

/* نسخة احتياطية محلية (تُستخدم فقط إذا تعذر الوصول للـ API) */
const FALLBACK_QUOTES = [
  { text: "النجاح ليس نهائياً، والفشل ليس قاتلاً: ما يهم هو الشجاعة على الاستمرار.", author: "ونستون تشرشل", cat: "success" },
  { text: "الحياة هي ما يحدث لك بينما أنت مشغول بالتخطيط لأشياء أخرى.", author: "جون لينون", cat: "life" },
  { text: "الحب لا يُقاس بالكلمات، بل بالحضور في التفاصيل الصغيرة.", author: "مجهول", cat: "love" },
  { text: "من جدّ وجد، ومن زرع حصد.", author: "مثل عربي", cat: "wisdom" },
  { text: "لا تنتظر الفرصة، بل اصنعها بنفسك.", author: "جورج برنارد شو", cat: "success" },
  { text: "الوقت كالسيف، إن لم تقطعه قطعك.", author: "مثل عربي", cat: "wisdom" },
  { text: "كل يوم هو فرصة جديدة لتغيير حياتك.", author: "مجهول", cat: "life" },
  { text: "أن تُحَب هو أن تُرى بعين لا تحتاج تفسيراً.", author: "مجهول", cat: "love" },
  { text: "الطريق إلى النجاح دائماً تحت الإنشاء.", author: "ليلي توملين", cat: "success" },
  { text: "لا تقس يومك بالمحصول الذي جنيته، بل بالبذور التي زرعتها.", author: "روبرت لويس ستيفنسون", cat: "life" },
  { text: "القلب يرى ما تعجز العين عن رؤيته.", author: "مجهول", cat: "love" },
  { text: "العقل السليم في الجسم السليم.", author: "مثل قديم", cat: "wisdom" },
];

/* =========================================================
   2) الحالة (STATE)
   ========================================================= */
const state = {
  currentQuote: null,
  activeCategory: "all",
  pools: { all: [], life: [], success: [], love: [], wisdom: [] }, // طوابير الاقتباسات الجاهزة
  fetching: false,
  usingFallback: false,
};

/* =========================================================
   3) عناصر DOM
   ========================================================= */
const els = {
  text: document.getElementById("quoteText"),
  author: document.getElementById("quoteAuthor"),
  tag: document.getElementById("quoteTag"),
  newBtn: document.getElementById("newQuoteBtn"),
  copyBtn: document.getElementById("copyBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  shareBtn: document.getElementById("shareBtn"),
  categories: document.getElementById("categories"),
  palette: document.getElementById("palette"),
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  toast: document.getElementById("toast"),
  card: document.getElementById("quoteCard"),
  sourceNote: document.getElementById("sourceNote"),
};

const CAT_LABELS = { life: "الحياة", success: "النجاح", love: "الحب", wisdom: "حكمة", all: "" };

/* =========================================================
   4) جلب دفعة اقتباسات من الـ API
   ========================================================= */
function parseTags(rawTags) {
  return (rawTags || "")
    .replace(/[\[\]']/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function matchesCategory(tags, category) {
  if (category === "all") return true;
  const keywords = CATEGORY_KEYWORDS[category] || [];
  return tags.some((tag) => keywords.some((kw) => tag.includes(kw)));
}

async function fetchQuoteBatch() {
  const offset = Math.floor(Math.random() * (DATASET_TOTAL_ROWS - BATCH_SIZE));
  const url =
    `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}` +
    `&config=default&split=train&offset=${offset}&length=${BATCH_SIZE}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("network");
  const data = await res.json();

  return data.rows
    .map((r) => ({
      text: (r.row.quote || "").trim(),
      author: "",
      tags: parseTags(r.row.tags),
    }))
    .filter((q) => q.text.length >= 12 && q.text.length <= 240);
}

/* يعبّي طوابير كل التصنيفات من دفعة واحدة، عشان ما نكرر الطلبات */
async function refillPools() {
  if (state.fetching) return;
  state.fetching = true;
  try {
    const batch = await fetchQuoteBatch();
    state.usingFallback = false;

    batch.forEach((q) => {
      state.pools.all.push(q);
      Object.keys(CATEGORY_KEYWORDS).forEach((cat) => {
        if (matchesCategory(q.tags, cat)) state.pools[cat].push(q);
      });
    });
  } catch (err) {
    state.usingFallback = true;
  } finally {
    state.fetching = false;
  }
}

/* =========================================================
   5) اختيار الاقتباس التالي
   ========================================================= */
async function nextQuote() {
  const cat = state.activeCategory;
  let pool = state.pools[cat];

  // إذا الطابور فاضي أو شارف يخلص، جيب دفعة جديدة بالخلفية
  if (pool.length < 3 && !state.fetching) {
    refillPools(); // لا ننتظرها، بس نطلقها بالخلفية للمرة الجاية
  }

  if (pool.length > 0) {
    return pool.shift();
  }

  // ما في شي جاهز بعد (أول تحميل) — ننتظر أول دفعة أو نستخدم النسخة المحلية
  await refillPools();
  pool = state.pools[cat];
  if (pool.length > 0) return pool.shift();

  // النسخة الاحتياطية المحلية
  const local = cat === "all" ? FALLBACK_QUOTES : FALLBACK_QUOTES.filter((q) => q.cat === cat);
  const source = local.length ? local : FALLBACK_QUOTES;
  return source[Math.floor(Math.random() * source.length)];
}

/* =========================================================
   6) العرض (RENDER)
   ========================================================= */
function renderQuote(quote) {
  state.currentQuote = quote;
  els.text.classList.remove("visible");

  setTimeout(() => {
    els.text.textContent = quote.text;

    if (quote.author) {
      els.author.textContent = `— ${quote.author}`;
      els.author.style.display = "";
    } else {
      els.author.style.display = "none";
    }

    const tagLabel = quote.tags && quote.tags[0] ? quote.tags[0] : CAT_LABELS[state.activeCategory];
    els.tag.textContent = tagLabel || "";
    els.tag.style.display = tagLabel ? "" : "none";

    els.text.classList.add("visible");
  }, 200);

  els.sourceNote.textContent = state.usingFallback
    ? "وضع بدون اتصال — تُعرض مجموعة محلية من الاقتباسات"
    : "اقتباس من مكتبة تضم أكثر من 5900 قول مأثور";
}

async function showNewQuote() {
  els.newBtn.disabled = true;
  const quote = await nextQuote();
  renderQuote(quote);
  els.newBtn.disabled = false;
}

/* =========================================================
   7) التصنيفات
   ========================================================= */
els.categories.addEventListener("click", (e) => {
  const btn = e.target.closest(".cat-btn");
  if (!btn) return;

  document.querySelectorAll(".cat-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  state.activeCategory = btn.dataset.cat;
  showNewQuote();
});

/* =========================================================
   8) لوحة الألوان (لون الشريط والخط المميز بالبطاقة)
   ========================================================= */
els.palette.addEventListener("click", (e) => {
  const swatch = e.target.closest(".swatch");
  if (!swatch) return;

  document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
  swatch.classList.add("active");

  const color = getComputedStyle(swatch).getPropertyValue("--sw").trim();
  document.documentElement.style.setProperty("--accent", color);
});

/* =========================================================
   9) وضع الليل / النهار + حفظ بـ localStorage
   ========================================================= */
function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  els.themeIcon.textContent = theme === "day" ? "🌙" : "☀️";
  localStorage.setItem("hamasat-theme", theme);
}

els.themeToggle.addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme") === "day" ? "night" : "day";
  applyTheme(current);
});

(function initTheme() {
  const saved = localStorage.getItem("hamasat-theme");
  applyTheme(saved || "night");
})();

/* =========================================================
   10) نسخ الاقتباس
   ========================================================= */
els.copyBtn.addEventListener("click", async () => {
  const q = state.currentQuote;
  if (!q) return;
  const full = q.author ? `"${q.text}" — ${q.author}` : `"${q.text}"`;
  try {
    await navigator.clipboard.writeText(full);
    showToast("تم النسخ ✓");
  } catch {
    showToast("تعذّر النسخ");
  }
});

/* =========================================================
   11) تحميل البطاقة كصورة
   ========================================================= */
els.downloadBtn.addEventListener("click", async () => {
  showToast("جاري التجهيز...");
  try {
    const canvas = await html2canvas(els.card, { backgroundColor: null, scale: 2 });
    const link = document.createElement("a");
    link.download = "quote-card.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("تم التحميل ✓");
  } catch {
    showToast("حدث خطأ أثناء التحميل");
  }
});

/* =========================================================
   12) المشاركة
   ========================================================= */
els.shareBtn.addEventListener("click", async () => {
  const q = state.currentQuote;
  if (!q) return;
  const full = q.author ? `"${q.text}" — ${q.author}` : `"${q.text}"`;

  if (navigator.share) {
    try {
      await navigator.share({ text: full });
    } catch {
      /* المستخدم ألغى المشاركة */
    }
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(full)}`, "_blank");
  }
});

/* =========================================================
   13) Toast
   ========================================================= */
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

/* =========================================================
   14) الأحداث الرئيسية + التشغيل الأول
   ========================================================= */
els.newBtn.addEventListener("click", showNewQuote);

showNewQuote();
