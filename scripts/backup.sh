#!/usr/bin/env bash
# Локальний бекап сайту «Твоє право» на ПК.
#   Що зберігає:
#     1) archive-db.sql — повний дамп бази архіву (D1). ЦЕ ГОЛОВНЕ:
#        incidents / evidence / submissions (контакти, IP-хеші) / audit_log
#        існують лише на серверах Cloudflare і в git НЕ потрапляють.
#     2) site-code.zip — знімок коду сайту на поточний git-коміт (для повноти).
#
# Запуск (з кореня проєкту):  bash scripts/backup.sh
#
# Бекапи лягають у backups/<дата-час>/ і навмисно ігноруються git-ом
# (у дампі є персональні дані заявників — у публічний репозиторій їм не можна).

set -euo pipefail
cd "$(dirname "$0")/.."

DB="tvoepravo_archive"
TS="$(date +%Y%m%d-%H%M%S)"
DIR="backups/$TS"
mkdir -p "$DIR"

echo "→ [1/2] Експорт бази архіву (D1)…"
npx wrangler d1 export "$DB" --remote --output "$DIR/archive-db.sql"

echo "→ [2/2] Знімок коду сайту (git archive HEAD)…"
git archive --format=zip HEAD -o "$DIR/site-code.zip"

# Короткий маніфест: що, коли, який коміт.
{
  echo "Бекап tvoepravo — $TS"
  echo "git commit: $(git rev-parse HEAD)"
  echo "рядків у дампі БД: $(wc -l < "$DIR/archive-db.sql")"
} > "$DIR/manifest.txt"

echo ""
echo "✓ Готово: $DIR"
ls -lh "$DIR"
