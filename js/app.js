// Пам'ятка — SPA без збірки. Роутинг: #/ (головна), #/s/<id> (ситуація).
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

  // ---------- Головна ----------
  function renderHome() {
    const groups = {};
    PUBLISHED.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });

    const groupsHtml = GROUP_ORDER.filter((g) => groups[g]).map((g) => `
      <section class="group-block">
        <h2>${g}</h2>
        <div class="cards">
          ${groups[g].map((s) =>
            `<a class="sit-card" href="#/s/${s.id}" data-search="${esc(s.title.toLowerCase())}">
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
      ${roadmapHtml()}
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
          <p><a href="#/">${icon("i-back", "icon")} До всіх ситуацій</a></p>
        </div>`;
      return;
    }

    const sidebar = renderSidebar(sit.id);
    const normsUsed = collectNorms(sit);

    app.className = "layout with-sidebar";
    app.innerHTML = `
      <aside class="sidebar">${sidebar}</aside>
      <article>
        <nav class="crumbs"><a href="#/">${icon("i-back", "icon")} Всі ситуації</a> · ${esc(sit.group)}</nav>
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
          `<a class="nav-item ${s.id === activeId ? "active" : ""}" href="#/s/${s.id}">
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
        <a class="panic-more" href="#/s/street-stop">Розібратися детально →</a>
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
  function render() {
    const hash = location.hash || "#/";
    // В архіві паніка-кнопка і статус не потрібні — вони про особисту ситуацію,
    // а не про документування. Клас на body вимикає їх у CSS.
    document.body.classList.toggle("archive-mode", hash.startsWith("#/archive"));
    if (hash.startsWith("#/archive") && window.ARCHIVE) { window.ARCHIVE.render(hash); return; }
    const m = hash.match(/^#\/s\/([\w-]+)/);
    if (m) {
      const sit = SITUATIONS.find((s) => s.id === m[1]);
      if (sit && !sit.stub) { renderSituation(sit); return; }
    }
    renderHome();
  }

  window.addEventListener("hashchange", render);

  document.getElementById("db-date").textContent = DB_UPDATED;

  // Кнопка підтримки — показуємо лише коли задано SUPPORT_URL.
  const supportLink = document.getElementById("support-link");
  if (supportLink && typeof SUPPORT_URL === "string" && SUPPORT_URL) {
    supportLink.href = SUPPORT_URL;
    supportLink.hidden = false;
  }

  initStatusSelect();
  render();
})();
