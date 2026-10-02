#!/usr/bin/env bash
# Täglicher Backup-Lauf im Container. Bei Fehler: Meldung ins Protokoll und, falls ALERT_WEBHOOK_URL gesetzt ist,
# eine Nachricht an den Betreiber (JSON {"text": ...}, passend für Slack, Microsoft Teams, ntfy und ähnliche Dienste).
set -u
while true; do
  if ! bash /backup.sh; then
    echo "BACKUP FEHLGESCHLAGEN ($(date -u +%FT%TZ))" >&2
    if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
      curl -fsS -m 20 -X POST -H 'Content-Type: application/json' \
        -d '{"text":"Schnell-Deal: Backup fehlgeschlagen. Bitte das Protokoll des Dienstes backup prüfen."}' \
        "${ALERT_WEBHOOK_URL}" || echo "Alarm konnte nicht gesendet werden." >&2
    fi
  fi
  sleep 86400
done
