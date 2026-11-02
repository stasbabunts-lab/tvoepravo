// Генерує src/og-data.js із js/data.js.
//
// Навіщо: сайт — SPA, воркер віддає той самий index.html на всі шляхи, тому
// без цього кожне посилання (у Threads, Telegram, месенджері) показує прев'ю
// головної, хоч би на яку сторінку вело. Воркер підставляє теги на льоту, але
// дані про ситуації живуть у js/data.js і в рантаймі воркеру недоступні.
//
// Джерело правди лишається одне — js/data.js. Цей скрипт лише перекладає його
// у формат, який wrangler вбудує у воркер. Запускається автоматично перед
// кожним деплоєм (див. [build] у wrangler.toml), тож руками його чіпати не треба.

import fs from "node:fs";
import vm from "node:vm";

const SRC = "js/data.js";
const ARC_SRC = "js/archive-data.js";
const OUT = "src/og-data.js";

// data.js та archive-data.js — звичайні скрипти для браузера (не модулі), тому виконуємо їх
// в пісочниці й забираємо потрібні const через globalThis.
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(SRC, "utf8") + ";globalThis.__S = SITUATIONS;", ctx);
if (fs.existsSync(ARC_SRC)) {
  vm.runInContext(fs.readFileSync(ARC_SRC, "utf8") + ";globalThis.__C = ARC_CASES;", ctx);
}

// Опис у прев'ю обрізається приблизно на 200 символах — ріжемо самі,
// по межі слова, щоб не отримати обрубок посеред слова.
function clamp(text, max = 180) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/[\s,;:—–-]+\S*$/, "") + "…";
}

// Головна («/») сюди не входить: у index.html уже правильні теги.
const pages = {
  "/archive": {
    title: "Архів злочинів ТЦК — Твоє право",
    description: "Задокументовані випадки насильства й незаконних затримань. Свідчення зберігаються для скарг до ЄСПЛ і Комітету ООН з прав людини."
  },
  "/archive/add": {
    title: "Додати випадок в архів — Твоє право",
    description: "Зіткнулися з насильством чи незаконним затриманням — задокументуйте. Анонімно, без реєстрації."
  },
  "/advokaty": {
    title: "Адвокати, яким довіряємо — Твоє право",
    description: "Перевірені адвокати у справах мобілізації та ТЦК, з прямими контактами."
  },
  "/pro-proekt": {
    title: "Про проєкт — Твоє право",
    description: "Навігатор по нормах законодавства України при мобілізації: як він влаштований, як оновлюється база і що буде далі."
  }
};

for (const s of ctx.__S) {
  pages["/s/" + s.id] = {
    title: s.title + " — Твоє право",
    description: clamp(s.intro || s.stubNote || "Що законно, а що ні у цій ситуації — з посиланнями на норми.")
  };
}

for (const c of (ctx.__C || [])) {
  const place = [c.city, c.oblast].filter(Boolean).join(", ");
  pages["/archive/c/" + c.id] = {
    title: clamp(`${c.title}${place ? " — " + place : ""}`, 90) + " — Архів «Твоє право»",
    description: clamp(c.summary)
  };
}

fs.writeFileSync(
  OUT,
  "// ЗГЕНЕРОВАНО scripts/build-og.mjs — не редагувати вручну.\n" +
  "// Джерело: js/data.js. Оновлюється автоматично перед деплоєм.\n" +
  "export const OG = " + JSON.stringify(pages, null, 2) + ";\n",
  "utf8"
);

console.log(`build-og: ${Object.keys(pages).length} сторінок -> ${OUT}`);
