# Stage 1: Build the Frontend React SPA
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Go Backend
FROM golang:1.23-bookworm AS backend-builder
WORKDIR /app/backend
# Install build dependencies for SQLite CGO
RUN apt-get update && apt-get install -y gcc libc6-dev
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Build Go binary with CGO enabled
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-w -s" -o blockforgemd-backend main.go

# Stage 3: Final Production Image
FROM debian:bookworm-slim
WORKDIR /app
# Install runtime libraries
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
# Copy compiled backend binary
COPY --from=backend-builder /app/backend/blockforgemd-backend ./
# Copy compiled frontend assets
COPY --from=frontend-builder /app/backend/web-dist ./web-dist

# Run as UID/GID 1000 by default (most Linux desktop users).
# docker-compose overrides this via its 'user:' directive (PUID/PGID).
USER 1000:1000
EXPOSE 8080
VOLUME ["/workspace"]

ENTRYPOINT ["./blockforgemd-backend", "-workspace", "/workspace", "-port", "8080"]
