FROM node:22-bookworm-slim AS app

WORKDIR /app

COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 && \
    rm -rf /var/lib/apt/lists/*

RUN npm ci --omit=dev

COPY . .

EXPOSE 3080

CMD ["sh", "-c", "node src/migrate.js && exec node src/server.js"]

# Only the disposable desktop harness installs a server in the application image.
FROM app AS desktop-verify
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-16 && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "scripts/desktop.js", "run"]

FROM app AS production
