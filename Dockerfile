# syntax=docker/dockerfile:1

# ---- Frontend build ----
FROM node:22-alpine AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
COPY tailwind.config.js ./
RUN npm run build

# ---- Backend build (linux + windows amd64) ----
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/web ./web
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/patroni-ui .
RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/patroni-ui.exe .

# ---- Export stage: only the release binaries ----
FROM scratch AS export
COPY --from=build /out/patroni-ui /patroni-ui-linux-amd64
COPY --from=build /out/patroni-ui.exe /patroni-ui-windows-amd64.exe

# ---- Runtime image ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/patroni-ui /usr/local/bin/patroni-ui
ENV LISTEN=0.0.0.0:8000
ENV DATA_DIR=/var/lib/patroni-ui
EXPOSE 8000
ENTRYPOINT ["patroni-ui"]
