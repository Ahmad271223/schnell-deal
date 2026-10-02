#!/bin/sh
# Wird beim ersten Start eines leeren Datenverzeichnisses ausgeführt (docker-entrypoint-initdb.d).
# Erlaubt Basissicherungen (pg_basebackup, Replikationsprotokoll) aus dem Backup-Container über das Compose-Netz.
set -eu
echo "host replication all all scram-sha-256" >> "${PGDATA}/pg_hba.conf"
echo "pg_hba.conf: Replikationszugriff für Basissicherungen ergänzt"
