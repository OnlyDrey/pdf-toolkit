# syntax=docker/dockerfile:1
FROM node:24.22.2-alpine3.24@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# Optional CA for managed build environments; never retained in image layers.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci
COPY . .
# Public files may arrive with a restrictive host umask; UID 101 must be able to read them.
RUN npm run build && find dist -type d -exec chmod 755 {} + && find dist -type f -exec chmod 644 {} +

FROM nginx/nginx-unprivileged:1.30.6-alpine-slim@sha256:016193c18ef1ce19dc2229d3305f69af1b05e0bc0e8fe6ee724a58bd305f3855 AS runner
COPY --chmod=644 nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -Y off -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
# Bypass entrypoint scripts that try to edit a read-only configuration.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
