// Cloudflare Worker: статика (env.ASSETS) + API архіву на D1.
//   POST /api/submit        — прийом свідчення (Turnstile + дедуп + запис у pending)
//   GET  /api/cases         — опубліковані (verified) записи для гідратації фронта
//   GET  /api/mod/queue     — черга модерації           } за Cloudflare Access (/api/mod/*)
//   POST /api/mod/verify    — підтвердити інцидент       }
//   POST /api/mod/reject    — відхилити                  }
//   POST /api/mod/merge     — об'єднати дублі             }
//
// Усе інше віддається як статичний асет.

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      // База ще не підключена (деплой без D1): статика працює, API чесно каже 503.
      if (p.startsWith("/api/") && !env.DB) {
        return json({ error: "backend_not_configured", message: "Приймання свідчень ще не активовано." }, 503);
      }
      if (p === "/api/submit" && request.method === "POST") return await handleSubmit(request, env);
      if (p === "/api/cases" && request.method === "GET") return await handleCases(env);
      if (p.startsWith("/api/mod/")) return await handleMod(request, env, p);
      if (p.startsWith("/api/")) return json({ error: "not_found" }, 404);
    } catch (err) {
      return json({ error: "server_error", detail: String(err && err.message || err) }, 500);
    }
    // Статика.
    return env.ASSETS.fetch(request);
  }
};

// ---------- Прийом свідчення ----------
async function handleSubmit(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "bad_json" }, 400);

  const category = str(body.category);
  const type = str(body.type);
  const oblast = str(body.oblast);
  const summary = str(body.summary);
  if (!category || !type || !oblast || !summary) return json({ error: "missing_fields" }, 400);
  if (summary.length > 5000) return json({ error: "summary_too_long" }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = await sha256(ip + "|" + (env.IP_SALT || "tvoepravo"));

  // Turnstile (якщо секрет налаштовано).
  let turnstileOk = 0;
  if (env.TURNSTILE_SECRET) {
    turnstileOk = await verifyTurnstile(body.turnstileToken, ip, env.TURNSTILE_SECRET) ? 1 : 0;
    if (!turnstileOk) return json({ error: "turnstile_failed" }, 403);
  }

  // Простий анти-абуз: не більше 10 подань з IP за годину.
  const since = new Date(Date.now() - 3600e3).toISOString();
  const cnt = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > ?"
  ).bind(ipHash, since).first();
  if (cnt && cnt.n >= 10) return json({ error: "rate_limited" }, 429);

  const ts = now();
  const ev = Array.isArray(body.evidence) ? body.evidence[0] : null;
  const canonical = ev && str(ev.canonicalId) ? str(ev.canonicalId) : null;

  // Дедуп свідчень: чи є вже такий canonical_id?
  let existing = null;
  if (canonical) {
    existing = await env.DB.prepare(
      "SELECT incident_id FROM evidence WHERE canonical_id = ?"
    ).bind(canonical).first();
  }

  const subId = uuid();

  if (existing) {
    // Другий свідок того самого ролика: свідчення не задвоюємо, але подання
    // зберігаємо для модерації (контакт, контекст) і повідомляємо клієнта.
    await env.DB.prepare(
      "INSERT INTO submissions (id, incident_id, contact, ip_hash, user_agent, raw_json, turnstile_ok, is_duplicate, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(subId, existing.incident_id, str(body.contact) || null, ipHash,
      request.headers.get("User-Agent") || "", JSON.stringify(body), turnstileOk, 1, ts).run();
    await audit(env, existing.incident_id, "submit", null, "duplicate evidence, submission stored");
    return json({ status: "duplicate", incidentId: existing.incident_id }, 409);
  }

  // Новий інцидент (pending).
  const incId = uuid();
  await env.DB.prepare(
    `INSERT INTO incidents (id, category, type, oblast, city, incident_date, date_approx, summary, actors, courts, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`
  ).bind(incId, category, type, oblast, str(body.city) || null,
    str(body.date) || null, body.dateApprox ? 1 : 0, summary,
    JSON.stringify(arr(body.actors)), JSON.stringify(["ecthr", "un-hrc"]), ts, ts).run();

  if (ev && str(ev.url)) {
    await env.DB.prepare(
      "INSERT INTO evidence (id, incident_id, url, platform, canonical_id, hash, snapshot_url, captured_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(uuid(), incId, str(ev.url), str(ev.platform) || null, canonical,
      str(ev.hash) || null, str(ev.snapshotUrl) || null, str(ev.capturedAt) || null, ts).run();
  }

  await env.DB.prepare(
    "INSERT INTO submissions (id, incident_id, contact, ip_hash, user_agent, raw_json, turnstile_ok, is_duplicate, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(subId, incId, str(body.contact) || null, ipHash,
    request.headers.get("User-Agent") || "", JSON.stringify(body), turnstileOk, 0, ts).run();

  await audit(env, incId, "submit", null, "new incident, pending");
  return json({ status: "pending", incidentId: incId }, 201);
}

// ---------- Публічні записи ----------
async function handleCases(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM incidents WHERE status = 'verified' ORDER BY verified_at DESC LIMIT 500"
  ).all();
  const cases = [];
  for (const inc of results || []) {
    const ev = await env.DB.prepare(
      "SELECT url, platform, canonical_id, hash, snapshot_url, captured_at FROM evidence WHERE incident_id = ?"
    ).bind(inc.id).all();
    cases.push(shapeCase(inc, ev.results || []));
  }
  return new Response(JSON.stringify({ updated: now().slice(0, 10), cases }), {
    headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=300" }
  });
}

function shapeCase(inc, ev) {
  return {
    id: inc.id, category: inc.category, type: inc.type,
    oblast: inc.oblast, city: inc.city, date: inc.incident_date, dateApprox: !!inc.date_approx,
    title: inc.summary.slice(0, 80), summary: inc.summary,
    actors: safeJson(inc.actors, []), courts: safeJson(inc.courts, []),
    evidence: ev.map((e) => ({
      url: e.url, platform: e.platform, canonicalId: e.canonical_id,
      hash: e.hash, snapshotUrl: e.snapshot_url, capturedAt: e.captured_at
    })),
    status: "verified", addedAt: inc.created_at, verifiedAt: inc.verified_at
  };
}

// ---------- Модерація (за Cloudflare Access) ----------
async function handleMod(request, env, p) {
  // Cloudflare Access гейтить маршрут на edge і додає заголовок з JWT.
  // Тут — базова перевірка присутності; повну верифікацію JWT див. ARCHIVE_SETUP.md.
  const actor = request.headers.get("Cf-Access-Authenticated-User-Email");
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt && !env.ALLOW_INSECURE_MOD) return json({ error: "forbidden" }, 403);

  if (p === "/api/mod/queue" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM incidents WHERE status = 'pending' ORDER BY created_at ASC LIMIT 200"
    ).all();
    const out = [];
    for (const inc of results || []) {
      const ev = await env.DB.prepare("SELECT * FROM evidence WHERE incident_id = ?").bind(inc.id).all();
      const subs = await env.DB.prepare(
        "SELECT contact, is_duplicate, created_at FROM submissions WHERE incident_id = ?"
      ).bind(inc.id).all();
      out.push({ ...inc, evidence: ev.results || [], submissions: subs.results || [] });
    }
    return json({ queue: out });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = str(body.id);
    if (!id) return json({ error: "missing_id" }, 400);
    const ts = now();

    if (p === "/api/mod/verify") {
      await env.DB.prepare("UPDATE incidents SET status='verified', verified_at=?, updated_at=? WHERE id=?")
        .bind(ts, ts, id).run();
      await audit(env, id, "verify", actor, str(body.note));
      return json({ ok: true });
    }
    if (p === "/api/mod/reject") {
      await env.DB.prepare("UPDATE incidents SET status='rejected', updated_at=? WHERE id=?").bind(ts, id).run();
      await audit(env, id, "reject", actor, str(body.note));
      return json({ ok: true });
    }
    if (p === "/api/mod/merge") {
      const into = str(body.into);
      if (!into) return json({ error: "missing_into" }, 400);
      await env.DB.prepare("UPDATE evidence SET incident_id=? WHERE incident_id=?").bind(into, id).run();
      await env.DB.prepare("UPDATE incidents SET status='merged', merged_into=?, updated_at=? WHERE id=?")
        .bind(into, ts, id).run();
      await audit(env, id, "merge", actor, "merged into " + into);
      return json({ ok: true });
    }
  }
  return json({ error: "not_found" }, 404);
}

// ---------- Утиліти ----------
function str(v) { return typeof v === "string" ? v.trim() : (v == null ? "" : String(v)); }
function arr(v) { return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; }
function safeJson(s, def) { try { return JSON.parse(s); } catch { return def; } }

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function audit(env, incidentId, action, actor, note) {
  await env.DB.prepare(
    "INSERT INTO audit_log (id, incident_id, action, actor, note, created_at) VALUES (?,?,?,?,?,?)"
  ).bind(uuid(), incidentId || null, action, actor || null, note || null, now()).run();
}

async function verifyTurnstile(token, ip, secret) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await r.json().catch(() => ({}));
  return !!data.success;
}
