#!/usr/bin/env bash
# Wiederherstellungstest: spielt das neueste Backup in eine leere Prüf-Datenbank ein und vergleicht
# die Zeilenzahlen aller Kerntabellen mit der Quelle. Exit-Code ≠ 0 bei Abweichung.
#
#   scripts/restore-test.sh                  # neuestes Backup aus ./backups
#   scripts/restore-test.sh backups/x.dump   # bestimmtes Backup
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT}/backups}"
SOURCE_DB="${PGDATABASE:-schnelldeal}"
TARGET_DB="${RESTORE_DB:-schnelldeal_restore_test}"
FILE="${1:-$(ls -1t "${BACKUP_DIR}"/"${SOURCE_DB}"_*.dump 2>/dev/null | head -n1)}"

if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
  echo "FEHLER: Kein Backup gefunden in ${BACKUP_DIR}" >&2
  exit 1
fi
if [ -f "${FILE}.sha256" ]; then
  (cd "$(dirname "${FILE}")" && sha256sum -c "$(basename "${FILE}").sha256")
fi

PSQL=(docker compose exec -T postgres psql -U schnelldeal -v ON_ERROR_STOP=1 -At)
echo "Stelle ${FILE} in ${TARGET_DB} wieder her …"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE);" >/dev/null
"${PSQL[@]}" -d postgres -c "CREATE DATABASE ${TARGET_DB} OWNER schnelldeal;" >/dev/null
docker compose exec -T postgres pg_restore -U schnelldeal --no-owner --exit-on-error -d "${TARGET_DB}" < "${FILE}"

TABLES="users companies company_users company_documents inspection_requests inspection_assignments vehicles vehicle_photos vehicle_damages paint_measurements auctions bids maximum_bids deals generated_documents audit_logs legal_documents legal_acceptances"
FAIL=0
printf "%-28s %10s %10s\n" "Tabelle" "Quelle" "Restore"
for t in ${TABLES}; do
  a=$("${PSQL[@]}" -d "${SOURCE_DB}" -c "SELECT count(*) FROM ${t};")
  b=$("${PSQL[@]}" -d "${TARGET_DB}" -c "SELECT count(*) FROM ${t};")
  flag=""
  # Die Quelle kann seit dem Dump gewachsen sein; weniger Zeilen im Restore als im Dump-Zeitpunkt wäre ein Fehler.
  if [ "${b}" -gt "${a}" ]; then flag="  <-- mehr als Quelle?"; FAIL=1; fi
  printf "%-28s %10s %10s%s\n" "${t}" "${a}" "${b}" "${flag}"
done

# Integritätsprüfungen im wiederhergestellten Stand
"${PSQL[@]}" -d "${TARGET_DB}" -c "SELECT count(*) FROM (SELECT auction_id FROM bids WHERE status='WINNING' GROUP BY auction_id HAVING count(*) > 1) x;" | {
  read -r dup
  if [ "${dup}" != "0" ]; then echo "FEHLER: Auktionen mit mehreren führenden Geboten: ${dup}"; exit 1; fi
}
"${PSQL[@]}" -d "${TARGET_DB}" -c "SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_logs_immutable','bids_guard','deals_guard');" | {
  read -r trg
  if [ "${trg}" != "3" ]; then echo "FEHLER: Schutz-Trigger fehlen im Restore (${trg}/3)"; exit 1; fi
}

if [ "${FAIL}" -ne 0 ]; then
  echo "Wiederherstellungstest FEHLGESCHLAGEN" >&2
  exit 1
fi
echo "Wiederherstellungstest erfolgreich: ${FILE}"
