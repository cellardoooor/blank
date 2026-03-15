FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

COPY go.mod go.sum* ./
RUN go mod download -x 2>&1 || true

COPY . .
RUN go mod tidy -v 2>&1 && go mod download -x 2>&1 && \
    CGO_ENABLED=0 GOOS=linux go build -v -ldflags="-w -s" -o server ./cmd/server 2>&1 || true

FROM gcr.io/distroless/static-debian11

WORKDIR /app

COPY --from=builder /build/server .
COPY --from=builder /build/web ./web

EXPOSE 8080

USER nonroot:nonroot

ENTRYPOINT ["./server"]
