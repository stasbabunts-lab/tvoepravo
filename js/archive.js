// Архів: окремий модуль SPA. Роутинг делегується з app.js для шляхів /archive*.
//   /archive         — лендинг + перегляд/пошук
//   /archive/c/<id>  — картка випадку
//   /archive/add     — форма додавання (майстер із пошуком-перед-додаванням)
//
// Свідчення не зберігаються тут: форма POST-ить на /api/submit (Worker + D1).
// Опубліковані (verified) записи приходять статикою через ARC_CASES.

(function () {
  const API_BASE = ""; // той самий домен; Worker обробляє /api/*

  const icon = (id, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const catById = (id) => ARC_CATEGORIES.find((c) => c.id === id);
  const typeLabel = (cat, id) => (ARC_TYPES[cat] || []).find((t) => t.id === id)?.label || id || "";
  const actorLabel = (id) => ARC_ACTORS.find((a) => a.id === id)?.label || id;
  const courtById = (id) => ARC_COURTS.find((c) => c.id === id);

  // Публічний архів містить лише перевірені записи.
  const realCases = () => ARC_CASES;

  // ---------- Каноникалізація посилань і хеш ----------
  // Мета: одна й та сама відеозйомка від різних людей = один canonicalId → дедуп.
  const SHORTENERS = ["youtu.be", "t.me", "bit.ly", "cutt.ly", "is.gd", "goo.gl"];

  function canonicalizeUrl(raw) {
    let url;
    try { url = new URL(raw.trim()); } catch { return null; }
    let host = url.hostname.replace(/^www\./, "").toLowerCase();
    let platform = "web";
    let id = "";

    const path = url.pathname.replace(/\/+$/, "");
    const q = url.searchParams;

    if (host === "youtube.com" || host === "m.youtube.com") {
      platform = "youtube"; id = q.get("v") || path.split("/").pop() || "";
    } else if (host === "youtu.be") {
      platform = "youtube"; id = path.replace(/^\//, "");
    } else if (host === "tiktok.com") {
      platform = "tiktok"; id = (path.match(/\/video\/(\d+)/) || [])[1] || path;
    } else if (host === "t.me") {
      platform = "telegram"; id = path.replace(/^\//, ""); // <channel>/<post>
    } else if (host === "twitter.com" || host === "x.com") {
      platform = "twitter"; id = (path.match(/\/status\/(\d+)/) || [])[1] || path;
    } else if (host === "instagram.com") {
      platform = "instagram"; id = (path.match(/\/(reel|p)\/([^/]+)/) || [])[2] || path;
    } else if (host === "facebook.com" || host === "fb.watch") {
      platform = "facebook"; id = q.get("v") || path;
    } else {
      platform = "web"; id = path + (q.toString() ? "" : ""); // без трекінгових хвостів
    }

    id = (id || "").toLowerCase();
    const canonical = platform === "web"
      ? `web:${host}${path}`
      : `${platform}:${id}`;
    return { platform, id, canonical, host, isShortener: SHORTENERS.includes(host) };
  }

  async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------- Пошук по опублікованому архіву ----------
  function scoreMatch(c, { q, category, type, oblast, canonicals }) {
    let s = 0;
    // Збіг хоча б по одному посиланню — це майже напевно той самий випадок.
    if (canonicals?.length && c.evidence?.some((e) => canonicals.includes(e.canonicalId))) s += 100;
    if (category && c.category === category) s += 2;
    if (type && c.type === type) s += 3;
    if (oblast && c.oblast === oblast) s += 3;
    if (q) {
      const hay = `${c.title} ${c.summary} ${c.city} ${c.oblast}`.toLowerCase();
      if (q.split(/\s+/).every((w) => hay.includes(w))) s += 4;
    }
    return s;
  }

  function searchCases(filters) {
    return ARC_CASES
      .map((c) => ({ c, s: scoreMatch(c, filters) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }

  // ---------- Лендинг + перегляд ----------
  function renderLanding() {
    const cases = realCases();
    const courtsHtml = ARC_COURTS.map((c) => `
      <div class="arc-court">
        <h3>${esc(c.name)}</h3>
        <p class="arc-court-seat">${icon("i-scale")} ${esc(c.seat)}</p>
        <p>${esc(c.scope)}</p>
        <ul class="arc-court-arts">${c.articles.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        <p class="arc-court-note">${esc(c.note)}</p>
      </div>`).join("");

    const principlesHtml = ARC_PRINCIPLES.map((p) => `
      <div class="arc-principle">${icon(p.icon)}<div><strong>${esc(p.title)}</strong><p>${esc(p.text)}</p></div></div>`).join("");

    return `
      <nav class="crumbs"><a href="/">${icon("i-back", "icon")} На головну</a> · Архів</nav>

      <div class="arc-hero">
        <span class="arc-kicker">${icon("i-books")} Публічний архів свідчень</span>
        <h1>Архів злочинів ТЦК</h1>
        <p class="arc-lead">${esc(ARC_DISCLAIMERS.purpose)}</p>
        <div class="arc-hero-actions">
          <a class="arc-btn primary" href="/archive/add">${icon("i-siren")} Додати випадок</a>
        </div>
        <p class="arc-count">${cases.length ? `У відкритому доступі: <strong>${cases.length}</strong> перевірених записів` : ""}</p>
      </div>

      <section class="arc-section arc-courts-block">
        <h2>${icon("i-scale")} Для яких судів збираємо</h2>
        <p class="arc-section-lead">Докази зберігаються роками, щоб після війни ними можна було скористатися в міжнародних інстанціях:</p>
        <div class="arc-courts">${courtsHtml}</div>
      </section>

      <section class="arc-section">
        <h2>${icon("i-shield")} Як ми робимо записи придатними для суду</h2>
        <div class="arc-principles">${principlesHtml}</div>
        <div class="status-alert info" style="margin-top:14px">${icon("i-info")}<div>${esc(ARC_DISCLAIMERS.presumption)}</div></div>
      </section>

      <section class="arc-section" id="arc-browse">
        <h2>${icon("i-search")} Переглянути й знайти</h2>
        <div class="search-box">
          ${icon("i-search")}
          <input id="arc-q" type="search" placeholder="Пошук: місто, тип, опис…" autocomplete="off">
        </div>
        <div class="arc-filters">
          <select id="arc-f-type"><option value="">Усі типи</option>${(ARC_TYPES.tck || []).map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("")}</select>
          <select id="arc-f-obl"><option value="">Усі області</option>${ARC_OBLASTS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>
        </div>
        <div id="arc-list" class="arc-list"></div>
      </section>
    `;
  }

  function caseRow(c) {
    const cat = catById(c.category);
    return `
      <a class="arc-row" href="/archive/c/${esc(c.id)}">
        <div class="arc-row-icon">${icon(cat?.icon || "i-alert")}</div>
        <div class="arc-row-main">
          <p class="arc-row-title">${esc(c.title)}</p>
          <p class="arc-row-meta">${esc(cat?.short || "")} · ${esc(typeLabel(c.category, c.type))} · ${esc(c.oblast)}${c.city && c.city !== "—" ? ", " + esc(c.city) : ""} · ${esc(c.date)}${c.dateApprox ? " (≈)" : ""}</p>
        </div>
        <div class="arc-row-ev">${icon("i-video")} ${(c.evidence || []).length}</div>
      </a>`;
  }

  function bindBrowse(root) {
    const q = root.querySelector("#arc-q");
    const ft = root.querySelector("#arc-f-type");
    const fo = root.querySelector("#arc-f-obl");
    const list = root.querySelector("#arc-list");
    if (!list) return;

    function run() {
      const filters = { q: q.value.trim().toLowerCase(), type: ft.value, oblast: fo.value };
      const any = q.value || ft.value || fo.value;
      const items = any ? searchCases(filters) : ARC_CASES.slice();
      // Порожній архів без фільтрів — нічого не показуємо; «не знайдено» лише для пошуку.
      list.innerHTML = items.length
        ? items.map(caseRow).join("")
        : any
          ? `<p class="arc-empty">${icon("i-info")} Нічого не знайдено. Якщо ви свідок такого випадку — <a href="/archive/add">додайте його</a>.</p>`
          : "";
    }
    [q, ft, fo].forEach((el) => el && el.addEventListener("input", run));
    run();
    root._arcRerun = run; // для повторного показу після гідратації
  }

  // Прогресивна гідратація: якщо бекенд піднято — підтягуємо verified-записи.
  let hydrated = false;
  async function hydrateCases(root) {
    if (hydrated) return;
    try {
      const res = await fetch(`${API_BASE}/api/cases`, { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const data = await res.json();
      const known = new Set(ARC_CASES.map((c) => c.id));
      (data.cases || []).forEach((c) => { if (!known.has(c.id)) ARC_CASES.push(c); });
      hydrated = true;
      if (root._arcRerun) root._arcRerun();
      const cnt = root.querySelector(".arc-count");
      const n = realCases().length;
      if (cnt && n) cnt.innerHTML = `У відкритому доступі: <strong>${n}</strong> перевірених записів`;
    } catch { /* бекенд ще не піднято — лишаємось на статиці */ }
  }

  // ---------- Картка випадку ----------
  function renderCase(id) {
    const c = ARC_CASES.find((x) => x.id === id);
    if (!c) return `<div class="stub-page"><h1>Запис не знайдено</h1><p><a href="/archive">${icon("i-back")} До архіву</a></p></div>`;
    const cat = catById(c.category);
    const evHtml = (c.evidence || []).map((e, i) => `
      <div class="arc-ev">
        <div class="arc-ev-head">${icon("i-video")} Свідчення ${i + 1} ${e.platform ? `<span class="arc-badge neutral">${esc(e.platform)}</span>` : ""}</div>
        ${e.url ? `<p><a class="norm-ref" href="${esc(e.url)}" target="_blank" rel="noopener nofollow">${icon("i-external")} Першоджерело</a>${e.snapshotUrl ? ` · <a class="norm-ref" href="${esc(e.snapshotUrl)}" target="_blank" rel="noopener">архівна копія</a>` : ""}</p>` : `<p class="arc-muted">${esc(e.note || "")}</p>`}
        ${e.hash && e.hash !== "—" ? `<p class="arc-hash" title="SHA-256 канонічного посилання">${icon("i-shield")} ${esc(e.hash.slice(0, 24))}…</p>` : ""}
        ${e.capturedAt ? `<p class="arc-muted">Зафіксовано: ${esc(e.capturedAt)}</p>` : ""}
      </div>`).join("");

    return `
      <nav class="crumbs"><a href="/archive">${icon("i-back", "icon")} До архіву</a> · ${esc(cat?.label || "")}</nav>
      <header class="sit-head">
        <h1>${esc(c.title)}</h1>
        <div class="badges">
          <span class="badge neutral">${esc(typeLabel(c.category, c.type))}</span>
          <span class="badge neutral">${esc(c.oblast)}${c.city && c.city !== "—" ? ", " + esc(c.city) : ""}</span>
          <span class="badge neutral">${icon("i-clock")} ${esc(c.date)}${c.dateApprox ? " (приблизно)" : ""}</span>
        </div>
      </header>

      <p class="intro">${esc(c.summary)}</p>

      <section class="section">
        <h2>${icon("i-user")} Хто фігурує</h2>
        <p>${(c.actors || []).map((a) => `<span class="badge neutral">${esc(actorLabel(a))}</span>`).join(" ") || "—"}</p>
      </section>

      <section class="section">
        <h2>${icon("i-video")} Свідчення та джерела</h2>
        <div class="arc-ev-list">${evHtml || "<p>—</p>"}</div>
        <p style="margin-top:14px"><a class="arc-btn primary" href="/archive/add?to=${esc(c.id)}">${icon("i-siren")} Я теж свідок — додати своє свідчення</a></p>
      </section>

      <section class="section">
        <h2>${icon("i-scale")} Куди може піти</h2>
        <p>${(c.courts || []).map((cid) => `<span class="badge neutral">${esc(courtById(cid)?.name || cid)}</span>`).join(" ") || "—"}</p>
      </section>

      <div class="status-alert info">${icon("i-info")}<div>${esc(ARC_DISCLAIMERS.presumption)}</div></div>
    `;
  }

  // ---------- Форма додавання ----------
  function renderAdd() {
    // ?to=<id> — режим «додати свідчення до наявного запису» (кнопка на сторінці випадку).
    const attachTo = new URLSearchParams(location.search).get("to") || "";
    const target = attachTo ? ARC_CASES.find((c) => c.id === attachTo) : null;
    return `
      <nav class="crumbs"><a href="/archive">${icon("i-back", "icon")} До архіву</a> · ${attachTo ? "Додати свідчення" : "Додати випадок"}</nav>
      <div class="arc-hero compact">
        <h1>${attachTo ? "Додати свідчення до випадку" : "Додати випадок"}</h1>
        <p class="arc-lead">${attachTo
          ? "Опишіть, що бачили саме ви, і додайте свої посилання — навіть якщо це той самий ролик. Кожне незалежне свідчення підсилює запис."
          : "Заповнюйте лише те, що знаєте напевно. Якщо схожий запис уже є — нічого страшного: ми приймемо ваше свідчення і об'єднаємо записи."}</p>
      </div>
      ${attachTo ? `
      <div id="arc-attach-banner" class="status-alert info">${icon("i-link")}<div>Ваше свідчення буде додано до запису${target ? `: <strong>${esc(target.title)}</strong>` : ", який уже є в архіві"}. <button type="button" id="arc-attach-clear" class="arc-btn ghost small">Ні, це інший випадок</button></div></div>` : ""}

      <form id="arc-form" class="arc-form" novalidate data-attach="${esc(attachTo)}">
        <fieldset class="arc-fs">
          <legend>1. Що і де сталося</legend>
          <label>Тип випадку
            <select name="type" required>
              <option value="">— оберіть —</option>
              ${(ARC_TYPES.tck || []).map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("")}
            </select>
          </label>
          <div class="arc-two">
            <label>Область
              <select name="oblast" required>
                <option value="">— оберіть —</option>
                ${ARC_OBLASTS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
              </select>
            </label>
            <label>Місто / громада
              <input name="city" type="text" placeholder="напр. Одеса" autocomplete="off">
            </label>
          </div>
          <div class="arc-two">
            <label>Дата
              <input name="date" type="date">
            </label>
            <label class="arc-check-inline">
              <input name="dateApprox" type="checkbox"> Дата приблизна
            </label>
          </div>
        </fieldset>

        <fieldset class="arc-fs">
          <legend>2. Посилання на відео / пости</legend>
          <p class="arc-hint">${icon("i-info")} Чим більше незалежних джерел на один випадок — тим сильніший доказ. Додайте всі, які знаєте: різні ракурси, репости, новини.</p>
          <p class="arc-hint">${icon("i-video")} <strong>Відео чи аудіо лише у вас на пристрої?</strong> Завантажте файл на свій Google Drive, у налаштуваннях доступу оберіть «Усі, хто має посилання» — і вставте це посилання сюди. Оригінал файлу не видаляйте: він може знадобитися слідству чи суду.</p>
          <div id="arc-links"></div>
          <button type="button" id="arc-add-link" class="arc-btn ghost small">+ Ще посилання</button>
        </fieldset>

        <div id="arc-dupes" class="arc-dupes" hidden></div>

        <fieldset class="arc-fs">
          <legend>3. Опис і деталі</legend>
          <label>Короткий опис того, що сталося
            <textarea name="summary" rows="4" required placeholder="Що ви бачили? Формулюйте нейтрально: «на відео видно…», «за словами очевидця…»."></textarea>
          </label>
          <p class="arc-hint">${icon("i-info")} ${esc(ARC_DISCLAIMERS.privacy)}</p>
          <fieldset class="arc-actors">
            <legend class="arc-sub">Хто фігурує</legend>
            <div class="arc-chips-check">
              ${ARC_ACTORS.map((a) => `<label class="arc-chip-check"><input type="checkbox" name="actors" value="${a.id}"> ${esc(a.label)}</label>`).join("")}
            </div>
          </fieldset>
        </fieldset>

        <fieldset class="arc-fs">
          <legend>4. Зв'язок (не обов'язково, не публікується)</legend>
          <label>Контакт для уточнень — бачить лише модерація
            <input name="contact" type="text" placeholder="email або @telegram" autocomplete="off">
          </label>
          <p class="arc-hint">${icon("i-lock")} Це поле не потрапляє у відкритий архів. Можна лишити порожнім і подати анонімно.</p>
        </fieldset>

        <fieldset class="arc-fs arc-consent">
          <label class="arc-check-inline"><input type="checkbox" name="c_true" required> Підтверджую, що подаю достовірну інформацію.</label>
          <label class="arc-check-inline"><input type="checkbox" name="c_pub" required> Згоден(на) на публікацію у знеособленому вигляді.</label>
          <label class="arc-check-inline"><input type="checkbox" name="c_pres" required> Розумію: до вироку суду це заявлені свідчення, а не доведена вина.</label>
        </fieldset>

        <div id="arc-turnstile"></div>
        <div id="arc-form-msg" class="arc-form-msg" hidden></div>
        <button type="submit" class="arc-btn primary big">${icon("i-check")} Надіслати на модерацію</button>
        <p class="arc-hint">Запис з'явиться в архіві після перевірки модератором.</p>
      </form>
    `;
  }

  function bindAdd(root) {
    const form = root.querySelector("#arc-form");
    if (!form) return;
    const CATEGORY = "tck"; // архів наразі лише про злочини ТЦК
    const typeSel = form.type;
    const linksBox = root.querySelector("#arc-links");
    const dupes = root.querySelector("#arc-dupes");
    const msg = root.querySelector("#arc-form-msg");

    // ----- Список посилань (одне свідчення = один рядок) -----
    function linkRowHtml() {
      return `
        <div class="arc-link-row">
          <div class="arc-link-head">
            <span class="arc-link-num"></span>
            <button type="button" class="arc-link-del" aria-label="Прибрати посилання">✕</button>
          </div>
          <input class="arc-link-url" type="url" placeholder="https://…" autocomplete="off" inputmode="url">
          <div class="arc-url-info" hidden></div>
          <div class="arc-snapshot" hidden>
            <p class="arc-hint">${icon("i-shield")} Зробіть архівну копію (щоб доказ не зник) і вставте отримане посилання:</p>
            <div class="arc-snap-btns">
              <a class="arc-btn ghost small arc-snap-wayback" target="_blank" rel="noopener">Wayback Machine</a>
              <a class="arc-btn ghost small arc-snap-archive" target="_blank" rel="noopener">archive.today</a>
            </div>
            <input class="arc-link-snap" type="url" placeholder="https://web.archive.org/… або https://archive.ph/…" autocomplete="off">
          </div>
        </div>`;
    }

    function renumber() {
      const rows = [...linksBox.querySelectorAll(".arc-link-row")];
      rows.forEach((r, i) => {
        r.querySelector(".arc-link-num").textContent = `Посилання ${i + 1}`;
        // Останній рядок не даємо прибрати, якщо він єдиний.
        r.querySelector(".arc-link-del").hidden = rows.length === 1;
      });
    }

    function addRow() {
      linksBox.insertAdjacentHTML("beforeend", linkRowHtml());
      renumber();
    }
    addRow();

    root.querySelector("#arc-add-link").addEventListener("click", addRow);

    // «Ні, це інший випадок» — вимикає режим додавання до наявного запису.
    root.querySelector("#arc-attach-clear")?.addEventListener("click", () => {
      form.dataset.attach = "";
      const banner = root.querySelector("#arc-attach-banner");
      if (banner) banner.hidden = true;
      history.replaceState({}, "", "/archive/add");
    });

    linksBox.addEventListener("click", (e) => {
      const del = e.target.closest(".arc-link-del");
      if (!del) return;
      del.closest(".arc-link-row").remove();
      if (!linksBox.querySelector(".arc-link-row")) addRow();
      renumber();
      runDupeCheck();
    });

    // Розбір посилання + кнопки архівації для конкретного рядка.
    linksBox.addEventListener("input", (e) => {
      const inp = e.target.closest(".arc-link-url");
      if (!inp) { runDupeCheck(); return; }
      const row = inp.closest(".arc-link-row");
      const info = row.querySelector(".arc-url-info");
      const snap = row.querySelector(".arc-snapshot");
      const parsed = canonicalizeUrl(inp.value);
      if (parsed) {
        const val = inp.value.trim();
        info.hidden = false;
        info.innerHTML = `${icon("i-link")} Розпізнано: <strong>${esc(parsed.platform)}</strong>${parsed.isShortener ? ` <span class="arc-warn-inline">коротке посилання — краще вставити пряме</span>` : ""}`;
        snap.hidden = false;
        row.querySelector(".arc-snap-wayback").href = `https://web.archive.org/save/${val}`;
        row.querySelector(".arc-snap-archive").href = `https://archive.ph/?url=${encodeURIComponent(val)}`;
      } else {
        info.hidden = true;
        snap.hidden = true;
      }
      runDupeCheck();
    });

    // Усі заповнені рядки → масив свідчень (без порожніх і без повторів).
    function collectLinks() {
      const seen = new Set();
      return [...linksBox.querySelectorAll(".arc-link-row")].map((row) => {
        const url = row.querySelector(".arc-link-url").value.trim();
        if (!url) return null;
        const parsed = canonicalizeUrl(url);
        const canonicalId = parsed?.canonical || null;
        if (canonicalId && seen.has(canonicalId)) return null; // те саме посилання двічі
        if (canonicalId) seen.add(canonicalId);
        return {
          url,
          platform: parsed?.platform || "web",
          canonicalId,
          snapshotUrl: row.querySelector(".arc-link-snap").value.trim() || null
        };
      }).filter(Boolean);
    }

    [typeSel, form.oblast].forEach((el) => el.addEventListener("change", runDupeCheck));

    function runDupeCheck() {
      const canonicals = collectLinks().map((l) => l.canonicalId).filter(Boolean);
      const found = searchCases({
        category: CATEGORY, type: typeSel.value,
        oblast: form.oblast.value, canonicals
      });
      if (!found.length) { dupes.hidden = true; dupes.innerHTML = ""; return; }
      const exact = canonicals.length &&
        found.some((c) => c.evidence?.some((e) => canonicals.includes(e.canonicalId)));
      dupes.hidden = false;
      dupes.innerHTML = `
        <div class="arc-dupes-inner ${exact ? "exact" : ""}">
          ${icon("i-alert")}
          <div>
            <strong>${exact ? "Таке посилання вже є в архіві — ваше свідчення стане його підтвердженням." : "Можливо, цей випадок уже описано:"}</strong>
            <div class="arc-dupes-list">${found.slice(0, 4).map(caseRow).join("")}</div>
            <p class="arc-hint">Якщо це той самий випадок — усе одно надсилайте. Ми нічого не блокуємо: модератор об'єднає записи, а ваше свідчення підсилить наявний.</p>
          </div>
        </div>`;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.hidden = true;
      const fd = new FormData(form);

      if (!fd.get("c_true") || !fd.get("c_pub") || !fd.get("c_pres")) {
        return showMsg("Позначте всі три підтвердження внизу форми.", "err");
      }
      if (!fd.get("type") || !fd.get("oblast") || !String(fd.get("summary")).trim()) {
        return showMsg("Заповніть обов'язкові поля: тип, область, опис.", "err");
      }

      // Хеш рахуємо для кожного посилання окремо — це доказовий відбиток.
      const capturedAt = new Date().toISOString().slice(0, 10);
      const evidence = await Promise.all(collectLinks().map(async (l) => ({
        ...l,
        hash: await sha256(l.canonicalId || l.url),
        capturedAt
      })));

      const payload = {
        category: CATEGORY,
        type: fd.get("type"),
        oblast: fd.get("oblast"),
        city: String(fd.get("city") || "").trim(),
        date: fd.get("date") || null,
        dateApprox: !!fd.get("dateApprox"),
        summary: String(fd.get("summary")).trim(),
        actors: fd.getAll("actors"),
        contact: String(fd.get("contact") || "").trim(), // → захищений шар
        attachTo: form.dataset.attach || null, // свідчення до наявного запису
        evidence,
        turnstileToken: (window.turnstile && document.querySelector('[name="cf-turnstile-response"]')?.value) || null,
        submittedAt: new Date().toISOString()
      };

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/api/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("bad status " + res.status);
        const data = await res.json().catch(() => ({}));
        showMsg(data.suggestedMerge
          ? "Дякуємо! Схожий запис уже є в архіві — після модерації ваше свідчення буде об'єднано з ним."
          : "Дякуємо! Запис надіслано на модерацію. Після перевірки він з'явиться в архіві.", "ok");
        form.reset();
        linksBox.innerHTML = "";
        addRow();
        dupes.hidden = true;
      } catch (err) {
        // Бекенд ще не піднято (локальний перегляд) або мережева помилка.
        showMsg("Не вдалося надіслати зараз. Бекенд прийому може бути ще не налаштований. Дані форми збережено нижче — можна повторити пізніше.", "err");
        console.warn("submit failed", err, payload);
      } finally {
        btn.disabled = false;
      }
    });

    function showMsg(text, kind) {
      msg.hidden = false;
      msg.className = `arc-form-msg ${kind}`;
      msg.innerHTML = `${icon(kind === "ok" ? "i-check" : kind === "err" ? "i-ban" : "i-alert")} ${esc(text)}`;
      msg.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ---------- Turnstile (антиспам) ----------
  function mountTurnstile(root) {
    const holder = root.querySelector("#arc-turnstile");
    if (!holder || !ARC_TURNSTILE_SITEKEY) return;
    holder.innerHTML = `<div class="cf-turnstile" data-sitekey="${ARC_TURNSTILE_SITEKEY}"></div>`;
    if (!document.getElementById("cf-turnstile-script")) {
      const s = document.createElement("script");
      s.id = "cf-turnstile-script";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    } else if (window.turnstile) {
      window.turnstile.render(holder.querySelector(".cf-turnstile"));
    }
  }

  // ---------- Роутер ----------
  function render(path) {
    const app = document.getElementById("app");
    app.className = "layout";
    let m;
    if ((m = path.match(/^\/archive\/c\/([\w-]+)/))) {
      app.innerHTML = `<article>${renderCase(m[1])}</article>`;
    } else if (path.match(/^\/archive\/add/)) {
      app.innerHTML = `<article>${renderAdd()}</article>`;
      bindAdd(app);
      mountTurnstile(app);
    } else {
      app.innerHTML = `<article>${renderLanding()}</article>`;
      bindBrowse(app);
      hydrateCases(app);
    }
    window.scrollTo({ top: 0 });
  }

  window.ARCHIVE = { render };
})();
