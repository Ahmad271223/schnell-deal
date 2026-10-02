# Backup-Dienst: pg_dump + pg_basebackup aus dem Postgres-Image, rclone für die Kopie außer Haus (S3, R2, Backblaze, SFTP …).
FROM postgres:16-alpine
RUN apk add --no-cache bash coreutils findutils tar gzip rclone
COPY scripts/backup.sh /backup.sh
USER root
ENTRYPOINT ["/bin/bash", "-c", "while true; do bash /backup.sh || echo 'BACKUP FEHLGESCHLAGEN' >&2; sleep 86400; done"]
