#!/usr/bin/env bash
# Datenbanksicherung (Spezifikation §46):
#   1. Täglicher pg_dump (Custom-Format, komprimiert, SHA-256-Prüfsumme, Aufbewahrungsfrist).
#   2. Basissicherung (pg_basebackup) alle BASE_BACKUP_EVERY_DAYS Tage in das WAL-Archiv; zusammen mit den dort
#      archivierten WAL-Segmenten ist eine Wiederherstellung zu jedem Zeitpunkt möglich (scripts/pitr-restore-test.sh).
#   3. Optional Kopie außer Haus per rclone (OFFSITE_REMOTE, z. B. "offsite:schnelldeal-backups").
#
# Verwendung:
#   scripts/backup.sh                 # Dump nach ./backups (vom Entwicklungsrechner über den Compose-Container)
#   scripts/backup.sh --base          # zusätzlich sofort eine Basissicherung erzeugen
#   Im Container "backup": läuft täglich automatisch.
#
# Umgebungsvariablen:
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE  direkter Zugriff (Container mit pg_dump)
#   USE_DOCKER=1                                 Befehle im Compose-Container "postgres" ausführen (Standard, wenn pg_dump fehlt)
#   BACKUP_DIR (./backups)  RETENTION_DAYS (14)  WAL_ARCHIVE_DIR (/wal-archive im Container)
#   BASE_BACKUP_EVERY_DAYS (7)  BASE_RETENTION (2)  OFFSITE_REMOTE (leer = keine Kopie außer Haus)
#   STORAGE_REMOTE (rclone-Remote des Objektspeichers mit Bucket, z. B. "storage:schnelldeal-private"; leer = Fotos/Videos/PDFs
#   werden nicht außer Haus kopiert)  ALERT_WEBHOOK_URL (POST mit JSON {"text": ...} bei Fehlern, z. B. Slack/Teams/ntfy)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BASE_BACKUP_EVERY_DAYS="${BASE_BACKUP_EVERY_DAYS:-7}"
BASE_RETENTION="${BASE_RETENTION:-2}"
DB="${PGDATABASE:-schnelldeal}"
PGUSER="${PGUSER:-schnelldeal}"
# Im Container liegt DATABASE_URL aus der Env-Datei vor (dieselbe Verbindung wie die API). Sie hat Vorrang vor PGHOST/PGDATABASE,
# damit bei einer verwalteten Datenbank (Managed Postgres) nicht versehentlich der leere Compose-Postgres gesichert wird.
DB_URL="${DATABASE_URL:-}"
DB_URL_HOST="$(printf '%s' "${DB_URL}" | sed -nE 's#^[a-zA-Z]+://[^@/]*@([^:/?]+).*#\1#p')"
EXTERNAL_DB=0
if [ -n "${DB_URL_HOST}" ] && [ "${DB_URL_HOST}" != "${PGHOST:-postgres}" ] && [ "${DB_URL_HOST}" != "localhost" ] && [ "${DB_URL_HOST}" != "127.0.0.1" ]; then
  EXTERNAL_DB=1
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/${DB}_${STAMP}.dump"
FORCE_BASE=0
[ "${1:-}" = "--base" ] && FORCE_BASE=1

mkdir -p "${BACKUP_DIR}"

USE_DOCKER="${USE_DOCKER:-}"
if [ -z "${USE_DOCKER}" ]; then
  if command -v pg_dump >/dev/null 2>&1; then USE_DOCKER=0; else USE_DOCKER=1; fi
fi
# Im Container liegt das WAL-Archiv unter /wal-archive; vom Entwicklungsrechner aus wird es im Postgres-Container angesprochen.
if [ "${USE_DOCKER}" = "1" ]; then
  WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/wal-archive}"
  pgx() { docker compose exec -T postgres "$@"; }
else
  WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-}"
  pgx() { "$@"; }
fi

# ---------------------------------------------------------------- 1. Dump
if [ "${USE_DOCKER}" = "1" ]; then
  docker compose exec -T postgres pg_dump -U "${PGUSER}" --format=custom --compress=9 --no-owner "${DB}" > "${FILE}"
else
  pg_dump --format=custom --compress=9 --no-owner --dbname="${DB_URL:-${DB}}" --file="${FILE}"
fi
if [ ! -s "${FILE}" ]; then
  echo "FEHLER: Backup-Datei ist leer: ${FILE}" >&2
  exit 1
fi
SIZE=$(wc -c < "${FILE}")
sha256sum "${FILE}" > "${FILE}.sha256"
echo "Backup erstellt: ${FILE} (${SIZE} Bytes)"

# ---------------------------------------------------------------- 2. Basissicherung für Point-in-Time-Recovery
if [ "${EXTERNAL_DB}" = "1" ]; then
  # WAL-Archiv und pg_basebackup gehören zum Compose-Postgres; bei einer verwalteten Datenbank übernimmt deren Anbieter die
  # Zeitpunkt-Wiederherstellung. Der logische Dump oben stammt aus der echten Datenbank (DATABASE_URL).
  echo "Externe Datenbank (${DB_URL_HOST}): keine lokale Basissicherung, PITR liegt beim Datenbankanbieter."
  WAL_ARCHIVE_DIR=""
fi
if [ -n "${WAL_ARCHIVE_DIR}" ]; then
  BASE_DIR="${WAL_ARCHIVE_DIR}/base"
  pgx sh -c "mkdir -p '${BASE_DIR}'"
  LATEST_BASE="$(pgx sh -c "ls -1d '${BASE_DIR}'/base_* 2>/dev/null | sort | tail -n1" || true)"
  NEED_BASE=1
  if [ "${FORCE_BASE}" = "0" ] && [ -n "${LATEST_BASE}" ]; then
    AGE_DAYS="$(pgx sh -c "echo \$(( (\$(date +%s) - \$(stat -c %Y '${LATEST_BASE}')) / 86400 ))")"
    [ "${AGE_DAYS}" -lt "${BASE_BACKUP_EVERY_DAYS}" ] && NEED_BASE=0
  fi
  if [ "${NEED_BASE}" = "1" ]; then
    TARGET="${BASE_DIR}/base_${STAMP}"
    # -X none: die WAL-Segmente kommen aus dem Archiv; pg_basebackup wartet, bis das Ende der Sicherung archiviert ist.
    pgx sh -c "mkdir -p '${TARGET}' && pg_basebackup -U '${PGUSER}' -D '${TARGET}' --format=tar --gzip --wal-method=none --checkpoint=fast --label='schnelldeal ${STAMP}'"
    echo "Basissicherung erstellt: ${TARGET}"
    # Aufbewahrung: nur die letzten BASE_RETENTION Basissicherungen; WAL-Segmente vor der ältesten behaltenen werden entfernt.
    # Pfade immer innerhalb von sh -c übergeben: Git Bash unter Windows würde Argumente wie /wal-archive sonst in Windows-Pfade umschreiben.
    OLD="$(pgx sh -c "ls -1d '${BASE_DIR}'/base_* | sort | head -n -${BASE_RETENTION}" || true)"
    for d in ${OLD}; do pgx sh -c "rm -rf '${d}'"; echo "Alte Basissicherung entfernt: ${d}"; done
    OLDEST_KEPT="$(pgx sh -c "ls -1d '${BASE_DIR}'/base_* | sort | head -n1")"
    START_WAL="$(pgx sh -c "tar -xzOf '${OLDEST_KEPT}/base.tar.gz' backup_label | sed -n 's/.*(file \([0-9A-F]*\)).*/\1/p'")"
    if [ -n "${START_WAL}" ]; then
      pgx sh -c "pg_archivecleanup '${WAL_ARCHIVE_DIR}' '${START_WAL}'"
      echo "WAL-Archiv bereinigt bis ${START_WAL}"
    fi
  fi
fi

# ---------------------------------------------------------------- 3. Kopie außer Haus
if [ -n "${OFFSITE_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    rclone copy "${FILE}" "${OFFSITE_REMOTE}/dumps/" --no-traverse
    rclone copy "${FILE}.sha256" "${OFFSITE_REMOTE}/dumps/" --no-traverse
    if [ -n "${WAL_ARCHIVE_DIR}" ] && [ "${USE_DOCKER}" != "1" ]; then
      rclone sync "${WAL_ARCHIVE_DIR}" "${OFFSITE_REMOTE}/pitr/" --exclude '*.tmp'
    fi
    if [ -n "${STORAGE_REMOTE:-}" ]; then
      # Fotos, Videos, Dokumente und PDFs liegen im Objektspeicher und sind nicht Teil des Datenbank-Backups.
      rclone sync "${STORAGE_REMOTE}" "${OFFSITE_REMOTE}/objects/" --fast-list
      echo "Objektspeicher außer Haus synchronisiert: ${STORAGE_REMOTE} -> ${OFFSITE_REMOTE}/objects/"
    else
      echo "HINWEIS: STORAGE_REMOTE nicht gesetzt – Objektspeicher (Fotos, Videos, PDFs) wird nicht außer Haus gesichert." >&2
    fi
    echo "Kopie außer Haus aktualisiert: ${OFFSITE_REMOTE}"
  else
    echo "WARNUNG: OFFSITE_REMOTE gesetzt, aber rclone fehlt – keine Kopie außer Haus." >&2
  fi
fi

# ---------------------------------------------------------------- Aufbewahrung der Dumps
find "${BACKUP_DIR}" -name "${DB}_*.dump" -mtime "+${RETENTION_DAYS}" -print -delete
find "${BACKUP_DIR}" -name "${DB}_*.dump.sha256" -mtime "+${RETENTION_DAYS}" -delete
