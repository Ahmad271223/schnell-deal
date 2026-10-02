#!/bin/sh
# Point-in-Time-Recovery in einen Wegwerf-Container (läuft im Image postgres:16-alpine, siehe Compose-Dienst "pitr-restore").
# Erwartet: WAL_ARCHIVE_DIR mit base/base_*/base.tar.gz und archivierten WAL-Segmenten, TARGET_TIME (mit Zeitzone),
# VERIFY_DB + VERIFY_SQL (Abfrage im wiederhergestellten Stand), optional EXPECTED (erwartetes Ergebnis, sonst nur Ausgabe).
set -eu

WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/wal-archive}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
TARGET_TIME="${TARGET_TIME:?TARGET_TIME fehlt (z. B. 2026-10-02 12:00:00+00)}"
VERIFY_DB="${VERIFY_DB:-postgres}"
VERIFY_SQL="${VERIFY_SQL:-select now()}"
PGUSER="${PGUSER:-schnelldeal}"  # Datenbankrolle des gesicherten Clusters (POSTGRES_USER)

BASE="$(ls -1d "${WAL_ARCHIVE_DIR}"/base/base_* 2>/dev/null | sort | tail -n1 || true)"
if [ -z "${BASE}" ] || [ ! -f "${BASE}/base.tar.gz" ]; then
  echo "FEHLER: keine Basissicherung unter ${WAL_ARCHIVE_DIR}/base gefunden" >&2
  exit 1
fi
echo "Basissicherung: ${BASE}"
echo "Ziel-Zeitpunkt: ${TARGET_TIME}"

rm -rf "${PGDATA:?}"/* 2>/dev/null || true
mkdir -p "${PGDATA}"
tar -xzf "${BASE}/base.tar.gz" -C "${PGDATA}"
rm -f "${PGDATA}/postmaster.pid"
mkdir -p "${PGDATA}/pg_wal"
chown -R postgres:postgres "${PGDATA}"
chmod 700 "${PGDATA}"

touch "${PGDATA}/recovery.signal"
cat >> "${PGDATA}/postgresql.auto.conf" <<EOF
restore_command = 'cp ${WAL_ARCHIVE_DIR}/%f %p'
recovery_target_time = '${TARGET_TIME}'
recovery_target_inclusive = true
recovery_target_action = 'promote'
archive_mode = off
EOF
chown postgres:postgres "${PGDATA}/recovery.signal" "${PGDATA}/postgresql.auto.conf"

su-exec postgres postgres -D "${PGDATA}" -c listen_addresses='' -c unix_socket_directories=/tmp > /tmp/pitr.log 2>&1 &
PID=$!

i=0
until su-exec postgres psql -h /tmp -U "${PGUSER}" -d postgres -Atc "select not pg_is_in_recovery()" 2>/dev/null | grep -q t; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then
    echo "FEHLER: Wiederherstellung nicht innerhalb von 120 s abgeschlossen" >&2
    tail -n 40 /tmp/pitr.log >&2
    kill "${PID}" 2>/dev/null || true
    exit 1
  fi
  if ! kill -0 "${PID}" 2>/dev/null; then
    echo "FEHLER: Postgres-Prozess beendet" >&2
    tail -n 40 /tmp/pitr.log >&2
    exit 1
  fi
  sleep 1
done

RESULT="$(su-exec postgres psql -h /tmp -U "${PGUSER}" -d "${VERIFY_DB}" -Atc "${VERIFY_SQL}")"
echo "Prüfabfrage: ${VERIFY_SQL}"
echo "Ergebnis:    ${RESULT}"
grep -E "recovery stopping|last completed transaction|consistent recovery state" /tmp/pitr.log | tail -n 3 || true

su-exec postgres pg_ctl -D "${PGDATA}" stop -m fast >/dev/null 2>&1 || kill "${PID}" 2>/dev/null || true

if [ -n "${EXPECTED:-}" ] && [ "${RESULT}" != "${EXPECTED}" ]; then
  echo "FEHLER: erwartet '${EXPECTED}', erhalten '${RESULT}'" >&2
  exit 1
fi
echo "Zeitpunkt-Wiederherstellung erfolgreich."
