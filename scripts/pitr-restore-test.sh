#!/usr/bin/env bash
# Prüft die Point-in-Time-Recovery von Ende zu Ende (Spezifikation §46: „Wiederherstellung testen“):
#   1. Prüftabelle in einer eigenen Datenbank anlegen und Basissicherung erzeugen.
#   2. Eintrag „before“ schreiben, Zeitpunkt T merken, Eintrag „after“ schreiben, WAL-Segment archivieren lassen.
#   3. Basissicherung + WAL-Archiv in einen Wegwerf-Container bis T wiederherstellen.
#   4. Erwartung: nur „before“ ist vorhanden.
# Voraussetzung: docker compose up -d postgres (mit WAL-Archivierung aus docker-compose.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"
PROBE_DB="${PITR_PROBE_DB:-schnelldeal_pitr}"
PSQL=(docker compose exec -T postgres psql -U schnelldeal -v ON_ERROR_STOP=1 -At)

echo "1/4 Prüfdatenbank und Basissicherung …"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE);" >/dev/null
"${PSQL[@]}" -d postgres -c "CREATE DATABASE ${PROBE_DB} OWNER schnelldeal;" >/dev/null
"${PSQL[@]}" -d "${PROBE_DB}" -c "CREATE TABLE probe (id serial primary key, note text not null, at timestamptz not null default now());" >/dev/null
USE_DOCKER=1 bash scripts/backup.sh --base

echo "2/4 Änderungen nach der Basissicherung …"
"${PSQL[@]}" -d "${PROBE_DB}" -c "INSERT INTO probe (note) VALUES ('before');" >/dev/null
sleep 2
TARGET_TIME="$("${PSQL[@]}" -d "${PROBE_DB}" -c "SELECT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00';")"
sleep 2
"${PSQL[@]}" -d "${PROBE_DB}" -c "INSERT INTO probe (note) VALUES ('after');" >/dev/null
# WAL-Segment abschließen und archivieren lassen (archive_command des Postgres-Dienstes).
"${PSQL[@]}" -d postgres -c "SELECT pg_switch_wal();" >/dev/null
for i in $(seq 1 30); do
  PENDING="$("${PSQL[@]}" -d postgres -c "SELECT coalesce(last_archived_wal, '') <> '' AND last_failed_wal IS DISTINCT FROM last_archived_wal FROM pg_stat_archiver;")"
  READY="$(docker compose exec -T postgres sh -c 'ls /var/lib/postgresql/data/pg_wal/archive_status/*.ready 2>/dev/null | wc -l')"
  if [ "${READY}" = "0" ]; then break; fi
  sleep 1
done
docker compose exec -T postgres sh -c "ls -1 /wal-archive | grep -v '^base$' | wc -l" | sed 's/^/Archivierte WAL-Segmente: /'
echo "Ziel-Zeitpunkt T = ${TARGET_TIME} (zwischen 'before' und 'after')"

echo "3/4 Wiederherstellung bis T in einen Wegwerf-Container …"
docker compose --profile pitr run --rm \
  -e TARGET_TIME="${TARGET_TIME}" \
  -e VERIFY_DB="${PROBE_DB}" \
  -e VERIFY_SQL="select string_agg(note, ',' order by id) from probe" \
  -e EXPECTED="before" \
  pitr-restore

echo "4/4 Aufräumen …"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE);" >/dev/null
echo "PITR-Test erfolgreich: Stand zum Zeitpunkt T enthält 'before', aber nicht 'after'."
