# syntax=docker/dockerfile:1
FROM node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# Optional CA for managed build environments; never retained in image layers.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci
COPY . .
RUN npm run build

FROM nginx/nginx-unprivileged:1.31.8-alpine-slim@sha256:629d3227f39ec10201345e420e2d9d430e463a9893d374b515a8eb6541e71938 AS runner
COPY --chmod=644 nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -Y off -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
# Bypass entrypoint scripts that try to edit a read-only configuration.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
