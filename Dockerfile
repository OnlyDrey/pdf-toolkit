# syntax=docker/dockerfile:1
FROM node:24.19.0-alpine3.23 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# Optional CA for managed build environments; never retained in image layers.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.2-alpine AS runner
COPY --chmod=644 nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
# Bypass entrypoint scripts that try to edit a read-only configuration.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
