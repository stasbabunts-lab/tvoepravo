# Твоє право (tvoepravo.org.ua) — контекст для Claude

Навігатор по нормах законодавства України при мобілізації: типові ситуації → що законно, що ні, з посиланнями на статті. Статический сайт (vanilla HTML/CSS/JS, данные в js/data.js), хостится как assets-only Cloudflare Worker.

## Git-процесс (читать первым)

Проект живёт в git — **не создавать копий папок проекта**, вся история версий в git.

- Remote `origin` → https://github.com/stasbabunts-lab/tvoepravo, ветка `main` (репозиторий будет ПУБЛИЧНЫМ — портфолио владельца)
- После каждого законченного изменения: `git add` → `git commit` (осмысленное сообщение на английском) → `git push origin main`
- Секретов в проекте нет и быть не должно; `.wrangler/`, `.env` — в `.gitignore`

## Деплой

```bash
npx wrangler deploy   # → tvoepravo.org.ua (+ www), zone в Cloudflare
```

## Локальный просмотр

`.claude/launch.json` → `npx serve -l 4173 .`
