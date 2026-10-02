# Backup-Dienst: pg_dump + pg_basebackup aus dem Postgres-Image, rclone für die Kopie außer Haus (S3, R2, Backblaze, SFTP …).
FROM postgres:16-alpine
RUN apk add --no-cache bash coreutils findutils tar gzip rclone curl
COPY scripts/backup.sh /backup.sh
COPY infra/backup/run-daily.sh /run-daily.sh
USER root
# Täglicher Lauf; bei Fehler Meldung ins Protokoll und, falls ALERT_WEBHOOK_URL gesetzt ist, an den Betreiber (Slack/Teams/ntfy).
ENTRYPOINT ["/bin/bash", "/run-daily.sh"]
