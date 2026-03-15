FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

COPY go.mod go.sum* ./
RUN go mod download || true

COPY . .
RUN go mod tidy && go mod download && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o server ./cmd/server

FROM gcr.io/distroless/static-debian11

WORKDIR /app

COPY --from=builder /build/server .
COPY --from=builder /build/web ./web

EXPOSE 8080

USER nonroot:nonroot

ENTRYPOINT ["./server"]
