# Архів: налаштування бекенду (Cloudflare, безкоштовний тариф)

Розділ «Архів» працює на статиці одразу. Щоб форма справді **приймала** свідчення,
потрібно один раз підняти D1 + Turnstile + Access. Усе в межах free-плану.

## 1. Створити базу D1

```bash
npx wrangler d1 create tvoepravo_archive
```

Скопіюй `database_id` з виводу у `wrangler.toml` (поле `database_id = "REPLACE_WITH_D1_ID"`).

Застосуй схему:

```bash
npx wrangler d1 execute tvoepravo_archive --file=schema.sql --remote
```

## 2. Turnstile (антиспам)

1. Cloudflare Dashboard → **Turnstile** → Add site → домен `tvoepravo.org.ua`.
2. Отриманий **Site key** встав у `js/archive-data.js` → `ARC_TURNSTILE_SITEKEY`.
3. **Secret key** поклади у секрет воркера:

```bash
npx wrangler secret put TURNSTILE_SECRET
```

## 3. Cloudflare Access (захист модерації)

Zero Trust → **Access → Applications → Add** (self-hosted), до 50 користувачів безкоштовно.
Створи ДВА шляхи в застосунку (або два застосунки з однаковою політикою):

- `tvoepravo.org.ua/admin/*`
- `tvoepravo.org.ua/api/mod/*`

Політика: **Allow** → Emails → перелічи пошти модераторів. Метод входу: Google/One-time PIN.

Після цього сторінка `https://tvoepravo.org.ua/admin/moderation.html` і всі `/api/mod/*`
доступні лише після входу, а Cloudflare додає до запитів заголовки
`Cf-Access-Jwt-Assertion` і `Cf-Access-Authenticated-User-Email` (їх бачить воркер).

> Хардненґ: воркер зараз перевіряє лише **присутність** JWT (шар захисту — сам Access на edge).
> Для повної надійності варто верифікувати підпис JWT за JWKS команди Access
> (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`). Це TODO у `src/worker.js → handleMod`.

## 4. Деплой

```bash
npx wrangler deploy
```

## 5. Публічний архів (verified)

Форма пише у `pending`. Після `✓ Опублікувати` в модерації запис стає `verified`
і віддається через `GET /api/cases`. Фронт підтягує його автоматично (гідратація),
тож у відкритому архіві з'являються лише перевірені записи. Приклад-запис
(`example: true` у `js/archive-data.js`) можна лишити чи прибрати.

## Локальна перевірка бекенду

```bash
npx wrangler dev
```

`wrangler dev` піднімає воркер + локальний D1. Для локальної модерації без Access
можна тимчасово виставити `ALLOW_INSECURE_MOD = "1"` у `[vars]` — **у проді прибрати**.

## Що зберігається де

| Дані | Таблиця | Публічно? |
|------|---------|-----------|
| Інцидент (знеособлено) | `incidents` | так, після verified |
| Посилання + хеш + копія | `evidence` | так |
| Контакт заявника, IP-хеш, сирий payload | `submissions` | **ні**, лише модерація |
| Журнал дій | `audit_log` | ні |

Дедуп: `UNIQUE(canonical_id)` в `evidence` — той самий ролик не задвоюється; повторне
подання зберігається як `is_duplicate` (другий свідок), а на фронті спрацьовує
пошук-перед-додаванням.
