#!/usr/bin/env bash
set -euo pipefail
image=${1:-pdf-toolkit:verify}
name="pdf-toolkit-check-${RANDOM}"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --health-interval=2s --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m,uid=101,gid=101 --cap-drop ALL --security-opt no-new-privileges "$image" >/dev/null
for attempt in $(seq 1 40); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$name")
  [ "$state" != healthy ] || break
  [ "$state" != unhealthy ] || { docker logs "$name"; exit 1; }
  sleep 1
done
[ "$state" = healthy ] || { docker inspect -f '{{json .State.Health}}' "$name"; docker logs "$name"; exit 1; }
[ "$(docker inspect -f '{{.Config.User}}' "$name")" = '101:101' ]
docker exec "$name" sh -ec '
  wget -Y off -qO- http://127.0.0.1:8080/healthz | grep -qx ok
  wget -Y off -qO- http://127.0.0.1:8080/ | grep -q "<html"
  wget -Y off -qO- http://127.0.0.1:8080/nested/route | grep -q "<html"
  ! touch /usr/share/nginx/html/write-test 2>/dev/null
  worker=$(find /usr/share/nginx/html/assets -name "*.mjs" | head -n 1)
  worker_url=/assets/${worker##*/}
  wget -Y off -S -O /dev/null "http://127.0.0.1:8080$worker_url" 2>&1 | grep -qi "Content-Type: application/javascript"
  for asset in brand-mark.svg favicon.svg favicon-16.png favicon-32.png apple-touch-icon.png; do
    wget -Y off -qO /dev/null "http://127.0.0.1:8080/$asset"
  done
  nginx -t
'
headers=$(docker exec "$name" wget -Y off -S -O /dev/null http://127.0.0.1:8080/ 2>&1)
for header in Content-Security-Policy X-Content-Type-Options Referrer-Policy X-Frame-Options Permissions-Policy Cache-Control; do
  echo "$headers" | grep -qi "$header:"
done
printf 'Container startup, health, non-root, read-only filesystem and headers passed.\n'
