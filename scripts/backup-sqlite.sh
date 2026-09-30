#!/usr/bin/env bash

set -euo pipefail
umask 077

database=/var/www/meowcan/backend/data/meowcan.db
backup_dir=/home/ubuntu/data/backup
remote=10.0.0.211
remote_dir=/home/ubuntu/data/backup
name="meowcan-$(date -u +%F).sqlite3.gz"

mkdir -p "$backup_dir"
snapshot=$(mktemp "$backup_dir/.meowcan-snapshot.XXXXXXXX")
archive_tmp=$(mktemp "$backup_dir/.meowcan-archive.XXXXXXXX")
remote_tmp="$remote_dir/.$name.$$.partial"
remote_started=false

cleanup() {
  rm -f "$snapshot" "$archive_tmp"
  if [[ "$remote_started" == true ]]; then
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$remote" "rm -f '$remote_tmp'" || true
  fi
}
trap cleanup EXIT

sqlite3 -readonly "$database" ".backup '$snapshot'"
if [[ $(sqlite3 "$snapshot" 'PRAGMA integrity_check;') != ok ]]; then
  echo "SQLite backup failed integrity check" >&2
  exit 1
fi

gzip -c "$snapshot" > "$archive_tmp"
gzip -t "$archive_tmp"
archive="$backup_dir/$name"
mv -f "$archive_tmp" "$archive"

ssh -o BatchMode=yes -o ConnectTimeout=15 "$remote" "mkdir -p '$remote_dir' && chmod 700 '$remote_dir'"
remote_started=true
scp -q -o BatchMode=yes -o ConnectTimeout=15 "$archive" "$remote:$remote_tmp"

local_hash=$(sha256sum "$archive" | cut -d ' ' -f 1)
remote_hash=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$remote" "sha256sum '$remote_tmp'" | cut -d ' ' -f 1)
if [[ "$local_hash" != "$remote_hash" ]]; then
  echo "Remote backup checksum mismatch" >&2
  exit 1
fi

ssh -o BatchMode=yes -o ConnectTimeout=15 "$remote" "mv -f '$remote_tmp' '$remote_dir/$name' && find '$remote_dir' -maxdepth 1 -type f -name 'meowcan-*.sqlite3.gz' -mtime +6 -delete"
remote_started=false
find "$backup_dir" -maxdepth 1 -type f -name 'meowcan-*.sqlite3.gz' -mtime +6 -delete

echo "$(date -u +'%F %T UTC') backed up $name to both servers (SHA-256 $local_hash)"
