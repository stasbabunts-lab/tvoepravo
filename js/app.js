// Пам'ятка — SPA без збірки. Роутинг по справжніх шляхах (History API):
// / (головна), /s/<id> (ситуація), /archive* (архів). Worker робить SPA-fallback.
// Статус користувача живе лише в localStorage — жодних даних на сервер.

(function () {
  const app = document.getElementById("app");
  const statusSelect = document.getElementById("status-select");
  const panicBtn = document.getElementById("panic-btn");
  const panicOverlay = document.getElementById("panic-overlay");

  const STATUS_KEY = "pamyatka_status";

  const getStatus = () => localStorage.getItem(STATUS_KEY) || "none";
  const setStatus = (id) => { localStorage.setItem(STATUS_KEY, id); syncStatusUI(); render(); };

  const icon = (id, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  // Приватна аналітика: шлемо лише подію + ціль, без жодних персональних даних.
  // sendBeacon не блокує навігацію (важливо для кліку по tel:).
  function track(name, target) {
    try {
      const payload = JSON.stringify({ name, target: target || "" });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      } else {
        fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true });
      }
    } catch (e) { /* аналітика не має ламати сайт */ }
  }

  // Динамічні id згортаємо, щоб не плодити рядки в metrics.
  function normalizePath(p) {
    return p.replace(/^\/archive\/c\/[\w-]+$/, "/archive/c/:id");
  }
  let lastTrackedPath = null;
  function trackPageview() {
    const p = normalizePath(currentPath());
    if (p === lastTrackedPath) return; // не рахуємо повторний render тієї самої сторінки (зміна статусу тощо)
    lastTrackedPath = p;
    track("pageview", p);
  }

  const VOL_LABEL = { low: "стабільна норма", medium: "може змінюватися", high: "змінюється часто" };
  const GROUP_ORDER = ["Вулиця", "Транспорт", "У ТЦК", "Повістка", "Дім", "Робота", "ВЛК", "Документи", "Служба", "Кордон", "Наскрізне"];

  // Показуємо лише заповнені ситуації. Заглушки (stub) лишаються в data.js,
  // але не рендеряться як картки — вони формують блок «План розвитку».
  const PUBLISHED = SITUATIONS.filter((s) => !s.stub);
  const ROADMAP = SITUATIONS.filter((s) => s.stub);

  // Слот «Експерт проєкту» (плейсхолдер під бренд юриста-партнера).
  // Вимкнено на публічній версії; увімкни (true) для демо або коли з'явиться ім'я.
  const SHOW_EXPERT_SLOT = false;

  function expertSlot() {
    if (!SHOW_EXPERT_SLOT) return "";
    return `
      <div class="expert-slot">
        <div class="expert-avatar">${icon("i-user")}</div>
        <div class="expert-text">
          <p class="expert-role">Експерт проєкту</p>
          <p class="expert-hint">Тут буде юрист, чиєю експертизою звіряється контент</p>
        </div>
      </div>`;
  }

  // ---------- Статус ----------
  function initStatusSelect() {
    statusSelect.innerHTML = STATUSES.map(
      (s) => `<option value="${s.id}">${s.label}</option>`
    ).join("");
    statusSelect.value = getStatus();
    statusSelect.addEventListener("change", () => setStatus(statusSelect.value));
  }
  function syncStatusUI() { statusSelect.value = getStatus(); }

  function statusChips(context) {
    const current = getStatus();
    return `<div class="chips" data-context="${context}">` + STATUSES.map(
      (s) => `<button class="chip ${s.id === current ? "active" : ""}" data-status="${s.id}">${s.short}</button>`
    ).join("") + `</div>`;
  }

  function bindChips(root) {
    root.querySelectorAll(".chip[data-status]").forEach((el) =>
      el.addEventListener("click", () => setStatus(el.dataset.status))
    );
  }

  // ---------- Спільні шматки ----------
  function normRefs(ids) {
    if (!ids || !ids.length) return "";
    return "<br>" + ids.map((id) => {
      const n = NORMS[id];
      return n ? `<a class="norm-ref" href="${n.url}" target="_blank" rel="noopener" title="${esc(n.about)}">${esc(n.short)}</a>` : "";
    }).join("");
  }

  // Пункт видно, якщо статус не обрано або він проходить фільтри only/except.
  function itemVisible(it, status) {
    if (status === "none") return true;
    if (it.only && !it.only.includes(status)) return false;
    if (it.except && it.except.includes(status)) return false;
    return true;
  }

  function lawCard(items) {
    const cur = getStatus();
    const shown = items.filter((it) => itemVisible(it, cur));
    return `<ul>${shown.map((it) => `<li>${esc(it.text)} ${normRefs(it.norms)}</li>`).join("")}</ul>`;
  }

  function statusAlert(sit) {
    const cur = getStatus();
    if (cur === "none" || !sit.statuses || !sit.statuses[cur]) return "";
    const st = sit.statuses[cur];
    const stMeta = STATUSES.find((s) => s.id === cur);
    const ic = { ok: "i-check", info: "i-info", warning: "i-alert", danger: "i-siren" }[st.level];
    return `<div class="status-alert ${st.level}">${icon(ic)}<div><strong>${stMeta.label}:</strong> ${esc(st.text)}</div></div>`;
  }

  // TELEGRAM_URL приймає і "@handle", і повний URL. Порожньо = розділу немає.
  function tgHref() {
    const v = (typeof TELEGRAM_URL === "string" ? TELEGRAM_URL : "").trim();
    if (!v) return "";
    return v.startsWith("@") ? "https://t.me/" + v.slice(1) : v;
  }

  // Головна закінчується ситуаціями. Далі — не заклики, а навігація: три двері
  // однаковою вагою, без залитих кнопок, бо тут людина ще нічого від сайту не отримала.
  function alsoRow() {
    const tg = tgHref();
    const items = [
      `<a class="also-item" href="/archive" data-ev="archive_open" data-ev-t="home">
         ${icon("i-books")}
         <span><b>Архів злочинів ТЦК</b><span>Задокументовані випадки для скарг до ЄСПЛ</span></span>
       </a>`,
      (window.LAWYERS && window.LAWYERS.length)
        ? `<a class="also-item" href="/advokaty" data-ev="lawyers_open" data-ev-t="home">
             ${icon("i-scale")}
             <span><b>Адвокати</b><span>Перевірені, з прямими контактами</span></span>
           </a>` : "",
      tg ? `<a class="also-item" href="${esc(tg)}" target="_blank" rel="noopener" data-tg="home">
              ${icon("i-telegram")}
              <span><b>Канал у Telegram</b><span>Розбори випадків і зміни в нормах</span></span>
            </a>` : ""
    ].filter(Boolean).join("");
    return `
      <section class="also">
        <h2>Ще на сайті</h2>
        <div class="also-row">${items}</div>
      </section>`;
  }

  // ---------- «Що далі» в кінці ситуації ----------
  // Архів доречний там, де є що документувати: фізичний контакт, де можливе
  // насильство чи незаконне затримання. Довідкові сторінки (правила зйомки)
  // і «отримали повістку» сюди не входять — інциденту ще немає.
  const ARCHIVE_GROUPS = ["Вулиця", "Транспорт", "У ТЦК", "Дім", "Кордон", "ВЛК"];
  const ARCHIVE_IDS = ["masks", "porushennya", "zahyst"]; // наскрізні, але про інцидент
  const archiveRelevant = (sit) => ARCHIVE_GROUPS.includes(sit.group) || ARCHIVE_IDS.includes(sit.id);

  function nextArchive(sit) {
    return `
      <div class="next-item grave">
        ${icon("i-books")}
        <div class="next-body">
          <h3>Це сталося з вами?</h3>
          <p>Якщо було насильство чи примусова доставка — задокументуйте. Свідчення зберігаються для скарг до ЄСПЛ і Комітету ООН з прав людини.</p>
          <a class="next-act" href="/archive/add" data-ev="archive_open" data-ev-t="${esc(sit.id)}">Додати випадок в архів →</a>
        </div>
      </div>`;
  }

  function nextLawyers(sit) {
    if (!window.LAWYERS || !window.LAWYERS.length) return "";
    return `
      <div class="next-item">
        ${icon("i-scale")}
        <div class="next-body">
          <h3>Потрібна допомога юриста?</h3>
          <p>Адвокати, які ведуть справи проти ТЦК, з прямими контактами. Або цілодобова безоплатна лінія БПД: <a href="tel:${PHONE_LEGAL_AID.tel}">${PHONE_LEGAL_AID.label}</a>.</p>
          <a class="next-act" href="/advokaty" data-ev="lawyers_open" data-ev-t="${esc(sit.id)}">Дивитися адвокатів →</a>
        </div>
      </div>`;
  }

  // Канал — рядком, без картки й кнопки: це виноска, а не заклик. Привід чесний,
  // тому й формулювання різні: там, де норми справді хиткі, обіцяємо саме зміни.
  function nextTelegram(sit) {
    const href = tgHref();
    if (!href) return "";
    const text = sit.volatility === "high"
      ? "Норми в цій ситуації змінюються часто — сайт оновлюється не щодня. Про кожну зміну пишемо в каналі, там же розбираємо реальні випадки."
      : "У каналі розбираємо реальні випадки незаконних дій ТЦК — з посиланням на порушену норму. І пишемо, коли змінюються правила.";
    return `
      <div class="tg-line">
        ${icon("i-telegram")}
        <p>${text} <a href="${esc(href)}" target="_blank" rel="noopener" data-tg="situation">Канал у Telegram →</a></p>
      </div>`;
  }

  // Порядок за терміновістю: спершу дія по своїй справі, канал завжди останній.
  function nextSteps(sit) {
    const blocks = archiveRelevant(sit)
      ? nextArchive(sit) + nextLawyers(sit)
      : nextLawyers(sit);
    const tg = nextTelegram(sit);
    if (!blocks && !tg) return "";
    return `
      <section class="next">
        <h2>Що далі</h2>
        ${blocks}
        ${tg}
      </section>`;
  }

  // ---------- Розділ «Адвокати» ----------
  function renderLawyers() {
    const list = window.LAWYERS || [];
    const cards = list.map((l) => {
      const badges = [
        l.specialization ? `<span class="badge neutral">${esc(l.specialization)}</span>` : "",
        l.region ? `<span class="badge neutral">${icon("i-user")} ${esc(l.region)}</span>` : "",
        l.fee ? `<span class="badge warn">${esc(l.fee)}</span>` : ""
      ].join("");
      const contacts = (l.contacts || []).map((c) =>
        `<a class="lawyer-contact" href="${esc(c.value)}"${c.value.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}${c.type === "phone" ? ` data-call="${esc(l.id)}"` : ""}>
           ${icon(c.type === "phone" ? "i-phone" : "i-link")} ${esc(c.label)}
         </a>`).join("");
      const avatar = l.photo
        ? `<img class="lawyer-photo" src="${esc(l.photo)}" alt="${esc(l.name)}" loading="lazy">`
        : `<div class="lawyer-photo placeholder">${icon("i-user")}</div>`;
      return `
        <article class="lawyer-card" data-id="${esc(l.id)}">
          ${avatar}
          <div class="lawyer-body">
            <p class="lawyer-role">${esc(l.role || "Адвокат")}</p>
            <h3 class="lawyer-name">${esc(l.name)}</h3>
            <div class="badges">${badges}</div>
            <div class="lawyer-contacts">${contacts}</div>
          </div>
        </article>`;
    }).join("");

    app.className = "layout";
    app.innerHTML = `
      <nav class="crumbs"><a href="/">${icon("i-back", "icon")} На головну</a></nav>
      <div class="hero">
        <h1>Адвокати, яким довіряємо</h1>
        <p>Сайт — це навігатор по нормах, а не юридична консультація. Для складних чи спірних ситуацій зверніться до юриста. Ось адвокати з прямими контактами.</p>
      </div>
      <div class="lawyer-grid">${cards || "<p class=\"muted\">Список поповнюється.</p>"}</div>
    `;

    observeLawyerViews();
  }

  // Показ картки адвоката — раз на відкриття сторінки, коли її реально побачили.
  function observeLawyerViews() {
    const cards = app.querySelectorAll(".lawyer-card[data-id]");
    if (!cards.length) return;
    if (!("IntersectionObserver" in window)) {
      // Фолбек: без спостерігача рахуємо показ одразу.
      cards.forEach((c) => track("lawyer_view", c.getAttribute("data-id")));
      return;
    }
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        track("lawyer_view", en.target.getAttribute("data-id"));
        obs.unobserve(en.target); // рахуємо лише перший показ
      });
    }, { threshold: 0.5 });
    cards.forEach((c) => io.observe(c));
  }

  function roadmapHtml() {
    if (!ROADMAP.length) return "";
    return `
      <section class="roadmap">
        <h2>План розвитку</h2>
        <div class="roadmap-grid">
          ${ROADMAP.map((s) => `
            <div class="roadmap-item">
              ${icon(s.icon)}
              <div>
                <p class="roadmap-title">${esc(s.title)}</p>
                <p class="roadmap-group">${esc(s.group)}</p>
              </div>
            </div>`).join("")}
        </div>
      </section>`;
  }

  // ---------- «Про проєкт» ----------
  // План розвитку жив на головній, але вісім заглушок «це ми ще пишемо» —
  // не те, що потрібно людині в паніці. Для довіри й грантів він потрібен,
  // тому переїхав на власну сторінку, а з підвалу на неї веде посилання.
  function renderAbout() {
    const tg = tgHref();
    app.className = "layout";
    app.innerHTML = `
      <div class="about">
        <nav class="crumbs"><a href="/">${icon("i-back", "icon")} На головну</a></nav>
        <h1>Про проєкт</h1>
        <p class="about-lead">«Твоє право» — навігатор по нормах законодавства України при мобілізації. Ви обираєте свою ситуацію і бачите, що законно, що ні, і на які статті посилатися. Кожен факт має посилання на чинну редакцію норми на zakon.rada.gov.ua.</p>

        <section class="section">
          <h2>${icon("i-info")} Як це працює</h2>
          <ul class="rights-list">
            <li>${icon("i-check")} <span>Норми звіряються з чинними редакціями. База оновлена: <strong>${DB_UPDATED}</strong>.</span></li>
            <li>${icon("i-check")} <span>Кожна ситуація має мітку, наскільки норма стабільна — від «стабільна норма» до «змінюється часто».</span></li>
            <li>${icon("i-check")} <span>Сайт не збирає персональних даних: статус зберігається лише у вашому браузері.</span></li>
            <li>${icon("i-check")} <span>Це навігатор по нормах, а не юридична консультація. Перед важливими рішеннями — до <a href="/advokaty">адвоката</a> або на лінію БПД <a href="tel:${PHONE_LEGAL_AID.tel}">${PHONE_LEGAL_AID.label}</a>.</span></li>
          </ul>
        </section>

        ${roadmapHtml()}

        ${tg ? `
        <section class="section">
          <h2>${icon("i-telegram")} Канал проєкту</h2>
          <p class="about-p">Норми змінюються швидше, ніж оновлюється статичний сайт. Про кожну зміну і про реальні випадки незаконних дій ТЦК пишемо в каналі. <a href="${esc(tg)}" target="_blank" rel="noopener" data-tg="about">Канал у Telegram →</a></p>
        </section>` : ""}
      </div>`;
  }

  // ---------- Головна ----------
  function renderHome() {
    const groups = {};
    PUBLISHED.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });

    const groupsHtml = GROUP_ORDER.filter((g) => groups[g]).map((g) => `
      <section class="group-block">
        <h2>${g}</h2>
        <div class="cards">
          ${groups[g].map((s) =>
            `<a class="sit-card" href="/s/${s.id}" data-search="${esc(s.title.toLowerCase())}">
                 ${icon(s.icon)}
                 <h3>${esc(s.title)}</h3>
               </a>`
          ).join("")}
        </div>
      </section>`).join("");

    app.className = "layout";
    app.innerHTML = `
      <div class="hero">
        <h1>Ваші права під час мобілізації</h1>
        <p>Оберіть ситуацію — побачите, що законно, що ні, і на які норми посилатися. Кожен факт має посилання на закон.</p>
        <div class="search-box">
          ${icon("i-search")}
          <input id="search" type="search" placeholder="Пошук: блокпост, повістка, ВЛК…" autocomplete="off">
        </div>
      </div>
      ${expertSlot()}
      <div class="status-onboard">
        <p>Ваш статус — поради підлаштуються під нього:</p>
        ${statusChips("home")}
      </div>
      <div class="groups" id="groups">${groupsHtml}</div>
      ${alsoRow()}
    `;

    bindChips(app);

    const search = document.getElementById("search");
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      app.querySelectorAll(".sit-card").forEach((card) => {
        const title = card.querySelector("h3").textContent.toLowerCase();
        card.style.display = !q || title.includes(q) ? "" : "none";
      });
      app.querySelectorAll(".group-block").forEach((block) => {
        const visible = [...block.querySelectorAll(".sit-card")].some((c) => c.style.display !== "none");
        block.style.display = visible ? "" : "none";
      });
    });
  }

  // ---------- Сторінка ситуації ----------
  function renderSituation(sit) {
    if (sit.stub) {
      app.className = "layout";
      app.innerHTML = `
        <div class="stub-page">
          ${icon(sit.icon)}
          <h1>${esc(sit.title)}</h1>
          <p>${esc(sit.stubNote || "Матеріал готується.")}</p>
          <p><a href="/">${icon("i-back", "icon")} До всіх ситуацій</a></p>
        </div>`;
      return;
    }

    const sidebar = renderSidebar(sit.id);
    const normsUsed = collectNorms(sit);

    app.className = "layout with-sidebar";
    app.innerHTML = `
      <aside class="sidebar">${sidebar}</aside>
      <article>
        <nav class="crumbs"><a href="/">${icon("i-back", "icon")} Всі ситуації</a> · ${esc(sit.group)}</nav>
        <header class="sit-head">
          <h1>${esc(sit.title)}</h1>
          <div class="badges">
            ${sit.volatility === "high" ? `<span class="badge warn">${icon("i-alert")} норми змінюються часто</span>` : ""}
            <span class="badge neutral">${esc(sit.group)}</span>
          </div>
        </header>
        <p class="intro">${esc(sit.intro)}</p>
        ${expertSlot()}

        <div class="status-row">
          <p class="label">Ваш статус:</p>
          ${statusChips("sit")}
        </div>
        ${statusAlert(sit)}

        <div class="two-col">
          <div class="law-card legal">
            <header>${icon("i-scale")} Законно</header>
            ${lawCard(sit.legal)}
          </div>
          <div class="law-card illegal">
            <header>${icon("i-ban")} Незаконно</header>
            ${lawCard(sit.illegal)}
          </div>
        </div>

        ${sit.violations && sit.violations.length ? `
        <section class="section">
          <h2>${icon("i-alert")} Якщо порушують — що робити</h2>
          <div class="viol-list">
            ${sit.violations.map((v) => `
              <div class="viol-row">
                <p class="viol-if">${esc(v.if)}</p>
                <p class="viol-do">${esc(v.do)}</p>
              </div>`).join("")}
          </div>
        </section>` : ""}

        <section class="section">
          <h2>${icon("i-shield")} Ваші права</h2>
          <ul class="rights-list">
            ${sit.rights.map((r) => `<li>${icon("i-check")} <span>${esc(r)}</span></li>`).join("")}
          </ul>
        </section>

        <section class="section">
          <h2>${icon("i-video")} Відеофіксація</h2>
          <div class="video-grid">
            <div class="video-box can"><h3>Можна знімати</h3><ul>${sit.video.can.map((v) => `<li>${esc(v)}</li>`).join("")}</ul></div>
            ${sit.video.cant.length ? `<div class="video-box cant"><h3>Не можна</h3><ul>${sit.video.cant.map((v) => `<li>${esc(v)}</li>`).join("")}</ul></div>` : ""}
          </div>
        </section>

        <section class="section">
          <h2>${icon("i-siren")} Що робити: покроково</h2>
          <div class="steps">
            ${sit.checklist.map((c) => `
              <div class="step">
                <div class="num"></div>
                <div>
                  <h3>${esc(c.title)}</h3>
                  <p>${esc(c.sub)}${c.norm && NORMS[c.norm] ? ` ${normRefs([c.norm])}` : ""}</p>
                </div>
              </div>`).join("")}
          </div>
        </section>

        <section class="section">
          <h2>${icon("i-books")} Реєстр норм цієї ситуації</h2>
          <div class="norms-table">
            ${normsUsed.map((id) => {
              const n = NORMS[id];
              return `<div class="norm-row">
                <div class="norm-main">
                  <p class="norm-title"><a href="${n.url}" target="_blank" rel="noopener">${esc(n.title)}</a></p>
                  <p class="norm-about">${esc(n.about)}</p>
                </div>
                <span class="vol ${n.volatility}">${VOL_LABEL[n.volatility]}</span>
                <a class="ext" href="${n.url}" target="_blank" rel="noopener" aria-label="Відкрити на zakon.rada.gov.ua">${icon("i-external")}</a>
              </div>`;
            }).join("")}
          </div>
        </section>

        ${nextSteps(sit)}
      </article>
    `;
    bindChips(app);
    window.scrollTo({ top: 0 });
  }

  // Реєстр норм показує лише норми з пунктів, видимих для поточного статусу.
  function collectNorms(sit) {
    const cur = getStatus();
    const ids = new Set();
    [...sit.legal, ...sit.illegal]
      .filter((it) => itemVisible(it, cur))
      .forEach((it) => (it.norms || []).forEach((n) => ids.add(n)));
    (sit.checklist || []).forEach((c) => c.norm && ids.add(c.norm));
    return [...ids].filter((id) => NORMS[id]);
  }

  function renderSidebar(activeId) {
    const groups = {};
    PUBLISHED.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });
    return GROUP_ORDER.filter((g) => groups[g]).map((g) => `
      <div class="nav-group">
        <p class="nav-group-title">${g}</p>
        ${groups[g].map((s) =>
          `<a class="nav-item ${s.id === activeId ? "active" : ""}" href="/s/${s.id}">
             ${esc(s.title)}
           </a>`).join("")}
      </div>`).join("");
  }

  // ---------- Паніка ----------
  function openPanic() {
    const sit = SITUATIONS.find((s) => s.id === "street-stop");
    const cur = getStatus();
    const st = cur !== "none" && sit.statuses[cur];
    const stMeta = STATUSES.find((s) => s.id === cur);

    panicOverlay.innerHTML = `
      <div class="panic-inner">
        <div class="panic-header">
          <h1>${icon("i-siren")} Мене зупинили</h1>
          <button class="panic-close" aria-label="Закрити">✕</button>
        </div>
        <div class="panic-steps">
          ${sit.checklist.map((c) => `
            <div class="panic-step">
              <div class="num"></div>
              <div>
                <h2>${icon(c.icon || "i-check")} ${esc(c.title)}</h2>
                <p>${esc(c.sub)}</p>
              </div>
            </div>`).join("")}
        </div>
        ${st ? `<div class="panic-status ${st.level}"><strong>Ваш статус: ${stMeta.label}</strong>${esc(st.text)}</div>` : ""}
        <a class="panic-call" href="tel:${PHONE_LEGAL_AID.tel}">
          ${icon("i-phone")}
          <span><span class="small">${PHONE_LEGAL_AID.name}</span><span class="big">${PHONE_LEGAL_AID.label}</span></span>
        </a>
        <a class="panic-more" href="/s/street-stop">Розібратися детально →</a>
      </div>
    `;
    panicOverlay.hidden = false;
    document.body.style.overflow = "hidden";

    const steps = panicOverlay.querySelectorAll(".panic-step .num");
    steps.forEach((n, i) => (n.textContent = i + 1));

    panicOverlay.querySelector(".panic-close").addEventListener("click", closePanic);
    panicOverlay.querySelector(".panic-more").addEventListener("click", closePanic);
  }

  function closePanic() {
    panicOverlay.hidden = true;
    panicOverlay.innerHTML = "";
    document.body.style.overflow = "";
  }

  panicBtn.addEventListener("click", openPanic);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panicOverlay.hidden) closePanic(); });

  // ---------- Роутер ----------
  // Шляхи справжні (History API): / , /s/<id> , /archive*
  const currentPath = () => location.pathname.replace(/\/+$/, "") || "/";

  function navigate(path) {
    if (path === currentPath()) return;
    history.pushState({}, "", path);
    render();
  }

  function render() {
    const path = currentPath();
    trackPageview();
    // В архіві паніка-кнопка і статус не потрібні — вони про особисту ситуацію,
    // а не про документування. Клас на body вимикає їх у CSS.
    document.body.classList.toggle("archive-mode", path.startsWith("/archive"));
    if (path.startsWith("/archive") && window.ARCHIVE) { window.ARCHIVE.render(path); return; }
    if (path === "/advokaty") { renderLawyers(); return; }
    if (path === "/pro-proekt") { renderAbout(); return; }
    const m = path.match(/^\/s\/([\w-]+)/);
    if (m) {
      const sit = SITUATIONS.find((s) => s.id === m[1]);
      if (sit && !sit.stub) { renderSituation(sit); return; }
    }
    renderHome();
  }

  window.addEventListener("popstate", render);

  // Клік по телефону адвоката — фіксуємо як подію (до навігації на tel:).
  document.addEventListener("click", (e) => {
    const call = e.target.closest && e.target.closest(".lawyer-contact[data-call]");
    if (call) track("lawyer_call", call.getAttribute("data-call"));
    const tg = e.target.closest && e.target.closest("a[data-tg]");
    if (tg) track("tg_click", tg.getAttribute("data-tg"));
    const ev = e.target.closest && e.target.closest("a[data-ev]");
    if (ev) track(ev.getAttribute("data-ev"), ev.getAttribute("data-ev-t") || "");
  });

  // Внутрішні посилання ведемо через роутер, зовнішні й якорі (#…) лишаємо браузеру.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("/")) return; // зовнішні, tel:, mailto:, #якорі
    e.preventDefault();
    navigate(href);
  });

  document.getElementById("db-date").textContent = DB_UPDATED;

  // Кнопка підтримки — показуємо лише коли задано SUPPORT_URL.
  const supportLink = document.getElementById("support-link");
  if (supportLink && typeof SUPPORT_URL === "string" && SUPPORT_URL) {
    supportLink.href = SUPPORT_URL;
    supportLink.hidden = false;
  }

  // Посилання на канал у підвалі — видно на всіх сторінках, зокрема в архіві.
  const tgLink = document.getElementById("tg-link");
  if (tgLink && tgHref()) {
    tgLink.href = tgHref();
    tgLink.hidden = false;
  }

  // Сумісність зі старими посиланнями виду /#/archive — переводимо на /archive.
  // Спрацьовує і при відкритті ззовні, і при кліку вже на сайті (зміна хеша
  // не перезавантажує сторінку, тому слухаємо hashchange окремо).
  function migrateLegacyHash() {
    if (!location.hash.startsWith("#/")) return false;
    history.replaceState({}, "", location.hash.slice(1) || "/");
    return true;
  }
  window.addEventListener("hashchange", () => { if (migrateLegacyHash()) render(); });
  migrateLegacyHash();

  initStatusSelect();
  render();
})();
