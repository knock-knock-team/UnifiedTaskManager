FROM node:20-alpine AS build
WORKDIR /app

# Accept Vite env vars as build args and write them to .env for the build
ARG VITE_TURN_URL
ARG VITE_TURN_USERNAME
ARG VITE_TURN_CREDENTIAL

# copy package files from repository root (CI uses repo root as context)
COPY services/frontend/package.json services/frontend/package-lock.json* ./
RUN npm ci

# copy frontend sources
COPY services/frontend .

# Inject Vite env variables (if provided) so import.meta.env picks them up at build time
RUN printf "VITE_TURN_URL=%s\nVITE_TURN_USERNAME=%s\nVITE_TURN_CREDENTIAL=%s\n" "${VITE_TURN_URL:-}" "${VITE_TURN_USERNAME:-}" "${VITE_TURN_CREDENTIAL:-}" > .env

RUN npm run build

FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html
COPY --from=build /app/dist .
COPY services/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
