#!/usr/bin/env bash

set -euo pipefail

deploy_id="${1:-}"
if [[ ! "$deploy_id" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a full Git commit SHA as the deployment ID." >&2
  exit 2
fi

root=/var/www/meowcan
backend="$root/backend"
current_dist="$root/dist"
upload="/tmp/meowcan-deploy-$deploy_id"
stage="$root/.dist-$deploy_id"
released_at="$(date -u +%Y%m%dT%H%M%SZ)"
release="$root/releases/$released_at-${deploy_id:0:12}"

for artifact in frontend.tar.gz meowcan-server; do
  if [[ ! -f "$upload/$artifact" ]]; then
    echo "Missing deployment artifact: $artifact" >&2
    exit 2
  fi
done

if [[ ! -d "$current_dist" || ! -x "$backend/meowcan-server" ]]; then
  echo "The current production installation is incomplete." >&2
  exit 2
fi

mkdir -p "$release" "$stage"
trap 'rm -rf "$stage"' EXIT

# The full song library and generated charts live only on the server. Hard links
# keep the atomic directory swap fast and avoid duplicating several gigabytes.
if [[ -d "$current_dist/songs" ]]; then
  cp -al "$current_dist/songs" "$stage/songs"
fi
if [[ -d "$current_dist/charts" ]]; then
  cp -al "$current_dist/charts" "$stage/charts"
fi
tar -xzf "$upload/frontend.tar.gz" -C "$stage"

if [[ ! -f "$stage/index.html" || ! -s "$stage/assets/soundfonts/MagicSFver2.sf2" ]]; then
  echo "The frontend artifact is missing index.html or the Magic SoundFont." >&2
  exit 2
fi
if ! compgen -G "$stage/assets/spessasynth_processor.min-*.js" >/dev/null; then
  echo "The frontend artifact does not contain the SpessaSynth AudioWorklet." >&2
  exit 2
fi

cp -a "$backend/meowcan-server" "$release/meowcan-server"
install -m 775 "$upload/meowcan-server" "$backend/meowcan-server.next"

mv "$backend/meowcan-server.next" "$backend/meowcan-server"

rollback() {
  echo "Deployment failed; restoring the previous release." >&2
  if [[ -d "$release/dist" ]]; then
    if [[ -d "$current_dist" ]]; then
      mv "$current_dist" "$release/failed-dist"
    fi
    mv "$release/dist" "$current_dist"
  fi
  cp -a "$release/meowcan-server" "$backend/meowcan-server"
  sudo systemctl restart meowcan.service
}

if ! sudo systemctl restart meowcan.service; then
  rollback
  exit 1
fi

healthy=false
for _ in {1..15}; do
  if curl --fail --silent --show-error http://127.0.0.1:8080/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != true ]]; then
  rollback
  exit 1
fi

# The service startup applies embedded migrations. Keep the old frontend live
# until the new backend has passed its health check.
if ! mv "$current_dist" "$release/dist"; then
  rollback
  exit 1
fi
if ! mv "$stage" "$current_dist"; then
  rollback
  exit 1
fi

rm -rf "$upload"
echo "Deployed $deploy_id successfully. Previous release: $release"
