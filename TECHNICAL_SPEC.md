# Technical Specification - Messenger Application

## 1. Project Overview

### 1.1 Purpose
Production-ready messenger backend with WebSocket support, JWT authentication, and PostgreSQL persistence. Stateless architecture ready for horizontal scaling.

### 1.2 Key Features
- REST API + WebSocket real-time messaging
- JWT-based authentication (stateless, no server-side sessions)
- 1-to-1 messaging (no group chats)
- Opaque message payloads (server treats as binary blobs)
- Self-healing deployment with Docker Compose
- Infrastructure as Code with Terraform

### 1.3 Architecture Principles
- **Stateless**: JWT tokens only, no sessions
- **Immutable Infrastructure**: New version = new VM
- **Single VM deployment**: PostgreSQL + Application on same host
- **Graceful degradation**: App starts even without database
- **Self-contained**: No external managed services required

## 2. Technology Stack

### 2.1 Backend
- **Language**: Go 1.21+
- **Framework**: Standard library + Gorilla Mux
- **Database**: PostgreSQL 15+ with pgx driver
- **Authentication**: JWT (github.com/golang-jwt/jwt/v5)
- **WebSocket**: Gorilla WebSocket
- **Password Hashing**: bcrypt (golang.org/x/crypto)
- **UUID**: google/uuid

### 2.2 Frontend
- **Type**: Single Page Application (SPA)
- **Files**: HTML, CSS, Vanilla JavaScript
- **Location**: `/web/` directory, served by Go server

### 2.3 Infrastructure
- **Containerization**: Docker + Docker Compose
- **Base Images**: 
  - Build: `golang:1.21-alpine`
  - Runtime: `gcr.io/distroless/static-debian11`
  - Database: `postgres:15-alpine`
- **Cloud**: Yandex Cloud
- **IaC**: Terraform 1.9+
- **CI/CD**: GitHub Actions

## 3. Project Structure

```
.
├── cmd/server/main.go          # Application entry point
├── internal/
│   ├── app/app.go             # Application initialization, dependency injection
│   ├── auth/
│   │   ├── service.go         # JWT token generation/validation
│   │   └── middleware.go      # HTTP auth middleware
│   ├── config/config.go       # Configuration from env vars
│   ├── http/handler.go        # HTTP REST handlers
│   ├── model/
│   │   ├── user.go            # User entity
│   │   └── message.go         # Message entity
│   ├── service/
│   │   ├── user.go            # User business logic
│   │   └── message.go         # Message business logic
│   ├── storage/
│   │   ├── interfaces.go      # Repository interfaces
│   │   └── postgres/          # PostgreSQL implementations
│   │       └── storage.go     # Storage + UserRepo + MessageRepo
│   └── ws/
│       ├── handler.go         # WebSocket HTTP handler
│       └── hub.go             # WebSocket connection manager
├── web/                        # Frontend files
│   ├── index.html             # Main HTML
│   ├── app.js                 # JavaScript application
│   └── style.css              # Styles
├── migrations/
│   └── 001_init.sql           # Database schema
├── terraform/                  # Infrastructure
│   ├── network/               # VPC, subnet, security groups
│   ├── compute/               # VM with cloud-init
│   └── envs/dev/              # Environment configuration
├── docker-compose.yml         # Local development
├── Dockerfile                 # Application image
└── .github/workflows/         # CI/CD
    └── deploy.yml
```

## 4. Data Models

### 4.1 User
```go
type User struct {
    ID           uuid.UUID `json:"id"`
    Username     string    `json:"username"`
    PasswordHash string    `json:"-"` // Never exposed in JSON
    CreatedAt    time.Time `json:"created_at"`
}
```

### 4.2 Message
```go
type Message struct {
    ID         uuid.UUID `json:"id"`
    SenderID   uuid.UUID `json:"sender_id"`
    ReceiverID uuid.UUID `json:"receiver_id"`
    Payload    []byte    `json:"payload"` // Opaque binary data
    CreatedAt  time.Time `json:"created_at"`
}
```

### 4.3 Database Schema
```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_receiver ON messages(receiver_id);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
```

## 5. API Specification

### 5.1 Authentication
All protected endpoints require header: `Authorization: Bearer <token>`

### 5.2 Endpoints

#### POST /api/auth/register
Register new user.
```json
// Request
{
  "username": "string",
  "password": "string"
}

// Response 201
{
  "token": "jwt-token",
  "user": {
    "id": "uuid",
    "username": "string",
    "created_at": "timestamp"
  }
}

// Response 400
{
  "error": "username already exists"
}
```

#### POST /api/auth/login
Authenticate user.
```json
// Request
{
  "username": "string",
  "password": "string"
}

// Response 200
{
  "token": "jwt-token",
  "expires_at": "timestamp"
}

// Response 401
{
  "error": "invalid credentials"
}
```

#### GET /api/users/{id}
Get user by ID (requires auth).
```json
// Response 200
{
  "id": "uuid",
  "username": "string",
  "created_at": "timestamp"
}

// Response 404
{
  "error": "user not found"
}
```

#### POST /api/messages
Send message (requires auth).
```json
// Request
{
  "receiver_id": "uuid",
  "payload": [1, 2, 3, ...] // Array of bytes
}

// Response 201
{
  "id": "uuid",
  "sender_id": "uuid",
  "receiver_id": "uuid",
  "payload": [1, 2, 3, ...],
  "created_at": "timestamp"
}

// Response 400
{
  "error": "receiver not found"
}
```

#### GET /api/messages/{user_id}
Get message history with specific user (requires auth).
```json
// Query params: ?limit=50&offset=0

// Response 200
[
  {
    "id": "uuid",
    "sender_id": "uuid",
    "receiver_id": "uuid",
    "payload": [1, 2, 3, ...],
    "created_at": "timestamp"
  }
]
```

#### GET /ws
WebSocket endpoint (requires auth via query param).
```
ws://host:8080/ws?token=<jwt-token>
```

**WebSocket Message Format (Client → Server):**
```json
{
  "receiver_id": "uuid",
  "payload": [1, 2, 3, ...]
}
```

**WebSocket Message Format (Server → Client):**
```json
{
  "id": "uuid",
  "sender_id": "uuid",
  "receiver_id": "uuid",
  "payload": [1, 2, 3, ...],
  "created_at": "timestamp"
}
```

#### GET /health
Health check endpoint.
```json
// Response 200 (with DB)
{
  "status": "healthy",
  "database": "connected"
}

// Response 503 (without DB)
{
  "status": "degraded",
  "database": "disconnected"
}
```

## 6. Configuration

### 6.1 Environment Variables
| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| HTTP_ADDR | Server bind address | `:8080` | No |
| JWT_SECRET | JWT signing key | - | Yes |
| JWT_DURATION | Token lifetime | `24h` | No |
| DB_HOST | Database host | `localhost` | No |
| DB_PORT | Database port | `5432` | No |
| DB_USER | Database user | `messenger` | No |
| DB_PASSWORD | Database password | `messenger` | No |
| DB_NAME | Database name | `messenger` | No |
| DB_SSLMODE | SSL mode | `disable` | No |

### 6.2 Database Connection String Format
```
host=<host> port=<port> user=<user> password=<password> dbname=<name> sslmode=<mode>
```

## 7. Component Details

### 7.1 Application Initialization (internal/app/app.go)
1. Connect to PostgreSQL (graceful on failure)
2. Initialize repositories
3. Create services (auth, user, message)
4. Setup WebSocket hub
5. Build HTTP router with middleware
6. Add health check endpoint

### 7.2 Authentication Service (internal/auth/service.go)
- **Methods**:
  - `Register(username, password) (*User, error)`
  - `Login(username, password) (token string, err error)`
  - `ValidateToken(token string) (userID uuid.UUID, err error)`
- **Password Hashing**: bcrypt with default cost
- **JWT Claims**: `sub` (user ID), `exp` (expiration)

### 7.3 WebSocket Hub (internal/ws/hub.go)
- **Purpose**: Manages all active WebSocket connections
- **Features**:
  - User ID → Connection mapping
  - Broadcast to specific user
  - Automatic reconnection support
  - Heartbeat/ping-pong (optional)
- **Message Flow**:
  1. Client connects with JWT token
  2. Hub stores connection mapped to user ID
  3. Incoming messages routed by receiver_id
  4. If receiver offline, message stored in DB for later delivery

### 7.4 Storage Layer (internal/storage/postgres/)
**Storage struct**:
- Manages pgxpool.Pool
- Provides User() and Message() repositories
- Transaction support via WithTx()

**UserRepo**:
- `Create(ctx, *User) error`
- `GetByID(ctx, uuid) (*User, error)`
- `GetByUsername(ctx, string) (*User, error)`

**MessageRepo**:
- `Create(ctx, *Message) error`
- `GetByUserPair(ctx, user1, user2, limit, offset) ([]Message, error)`

### 7.5 HTTP Handlers (internal/http/handler.go)
- User registration/login
- Authenticated message endpoints
- JWT middleware injection
- Static file serving (web/)

## 8. Frontend Specification

### 8.1 Features
- User registration and login
- Real-time messaging via WebSocket
- Contact list (hardcoded demo for MVP)
- Message history loading
- Auto-reconnect on disconnect

### 8.2 Local Storage Keys
- `token` - JWT token
- `userId` - Current user UUID

### 8.3 WebSocket Protocol
1. Connection: `ws://host/ws?token=<jwt>`
2. On open: Log to console
3. On message: Parse JSON, display in UI
4. On close: Reconnect after 3 seconds
5. Send: JSON with receiver_id and payload array

## 9. Docker Configuration

### 9.1 Dockerfile (Multi-stage)
```dockerfile
# Stage 1: Build
FROM golang:1.21-alpine AS builder
RUN apk add --no-cache git ca-certificates tzdata
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o server ./cmd/server

# Stage 2: Runtime
FROM gcr.io/distroless/static-debian11
WORKDIR /app
COPY --from=builder /build/server .
COPY --from=builder /build/web ./web
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["./server"]
```

### 9.2 Docker Compose (Local Development)
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: messenger
      POSTGRES_PASSWORD: messenger
      POSTGRES_DB: messenger
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U messenger"]
      interval: 5s
      timeout: 5s
      retries: 5

  server:
    build: .
    environment:
      HTTP_ADDR: :8080
      JWT_SECRET: dev-secret
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: messenger
      DB_PASSWORD: messenger
      DB_NAME: messenger
      DB_SSLMODE: disable
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

### 9.3 Production Deployment (cloud-init)
- Install Docker and Docker Compose
- Create `/opt/messenger/` directory
- Write `.env` file with secrets
- Write `docker-compose.yml` with PostgreSQL + App
- Write `init.sql` with schema
- Systemd service to manage docker-compose
- PostgreSQL volume persisted on host
- App waits for PostgreSQL healthcheck
- Restart policy: unless-stopped

## 10. Infrastructure (Terraform)

### 10.1 Resources
1. **Network Module**:
   - VPC with CIDR `10.0.0.0/16`
   - Subnet `10.0.1.0/24` in ru-central1-a
   - Security Group:
     - Ingress: 22 (SSH), 8080 (HTTP) from 0.0.0.0/0
     - Egress: All

2. **Compute Module**:
   - VM: Ubuntu 22.04 LTS
   - Type: standard-v3 (2 cores, 4GB RAM, 20GB SSD)
   - Public IP via NAT
   - cloud-init user-data for provisioning

### 10.2 VM Lifecycle Strategy
- **Create Before Destroy**: Новая VM создаётся перед удалением старой
- **Zero Downtime**: Пока старая VM работает, новая разворачивается и запускается
- **Immutable Infrastructure**: Каждый деплой = чистая VM с актуальным образом
- **Automatic Cleanup**: Старая VM удаляется после успешного создания новой

### 10.3 Cloud-init Stages
1. Update packages
2. Install Docker & Docker Compose
3. Create `/opt/messenger/` structure
4. Write configuration files (.env, docker-compose.yml, init.sql)
5. Start messenger systemd service
6. Docker Compose pulls and starts containers

### 10.3 Variables
| Name | Type | Default | Description |
|------|------|---------|-------------|
| yc_token | string | - | YC OAuth token |
| yc_cloud_id | string | - | YC Cloud ID |
| yc_folder_id | string | - | YC Folder ID |
| zone | string | ru-central1-a | Availability zone |
| docker_image | string | - | Docker image URL |
| jwt_secret | string | - | JWT signing secret |
| db_password | string | - | PostgreSQL password |
| http_addr | string | `:8080` | Server bind address |

## 11. CI/CD Pipeline

### 11.1 GitHub Actions Workflow
**Triggers**: Push в main, теги v*
**Jobs**:
1. **Changes**:
   - Checkout с fetch-depth=0 для анализа истории
   - Анализ изменённых файлов с помощью git diff
   - Определение необходимости build (код приложения) и deploy (код + инфраструктура)

2. **Build**:
   - Needs: changes
   - Условие: `build == 'true'`
   - Setup Docker Buildx
   - Login to Docker Hub
   - Build и push образа с тегами: semver, latest, sha
   - Если build не нужен, job запускается но пропускает сборку

3. **Deploy**:
   - Needs: [changes, build]
   - Условие: `deploy == 'true'`
   - Checkout code
   - Setup Terraform с YC mirror
   - Terraform init с S3 backend
   - Terraform plan
   - Terraform apply -replace="module.compute..." (immutable infrastructure)
   - Create before destroy lifecycle для минимизации downtime
   - Output public IP

### 11.2 Required Secrets
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `YC_TOKEN`
- `YC_S3_ACCESS_KEY`
- `YC_S3_SECRET_KEY`
- `TF_STATE_BUCKET`
- `JWT_SECRET`
- `DB_PASSWORD`

### 11.3 Required Variables
- `YC_CLOUD_ID`
- `YC_FOLDER_ID`
- `HTTP_ADDR`
- `JWT_DURATION`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_NAME`
- `DB_SSLMODE`

## 12. Dependencies

### 12.1 Go Modules
```
github.com/golang-jwt/jwt/v5 v5.2.0
github.com/google/uuid v1.6.0
github.com/gorilla/mux v1.8.1
github.com/gorilla/websocket v1.5.1
github.com/jackc/pgx/v5 v5.5.2
github.com/joho/godotenv v1.5.1
golang.org/x/crypto v0.18.0
```

### 12.2 External Services
- Docker Hub (image registry)
- Yandex Cloud (compute, network, object storage)
- PostgreSQL 15 (database)

## 13. Error Handling

### 13.1 HTTP Status Codes
- 200: Success
- 201: Created
- 400: Bad Request (validation error)
- 401: Unauthorized (invalid/missing token)
- 404: Not Found
- 500: Internal Server Error

### 13.2 Error Response Format
```json
{
  "error": "human readable message"
}
```

### 13.3 Graceful Degradation
- If PostgreSQL unavailable: App starts in "degraded" mode
- Health endpoint returns 503 when DB down
- Registration/login fail with clear error messages
- WebSocket works with in-memory message delivery (no persistence)

## 14. Security Considerations

### 14.1 Authentication
- JWT tokens with HS256 signing
- 24h default expiration (configurable)
- bcrypt password hashing (adaptive cost)
- No sensitive data in JWT payload

### 14.2 Database
- Prepared statements via pgx (SQL injection protection)
- Password never logged or exposed in API
- SSL mode configurable (disable/dev/prod)
- Connection pooling (pgxpool)

### 14.3 Infrastructure
- Non-root container user (distroless)
- Security groups restrict ports
- Secrets via environment variables (never committed)
- Terraform state in encrypted S3 bucket

## 15. Testing Strategy

### 15.1 Unit Tests
- Authentication service (token generation/validation)
- Password hashing (bcrypt)
- Repository methods (mocked DB)

### 15.2 Integration Tests
- Full HTTP API flow
- WebSocket connection and message routing
- Database migrations

### 15.3 End-to-End
- Docker Compose local deployment
- Terraform plan validation
- CI/CD pipeline dry-run

## 16. Deployment Checklist

### 16.1 First Deployment
1. Create Yandex Cloud account
2. Get YC_TOKEN via OAuth
3. Create S3 bucket for Terraform state
4. Create service account with storage.editor role
5. Generate S3 access keys
6. Set all GitHub Secrets
7. Set all GitHub Variables
8. Push to main branch
9. Verify deployment in Actions logs
10. Test endpoints: health, register, login, WebSocket

### 16.2 Subsequent Deployments
1. Push changes to main
2. CI/CD automatically builds new image
3. Terraform recreates VM with new image
4. Docker Compose starts services
5. Verify in browser: `http://<public_ip>:8080`

## 17. Troubleshooting

### 17.1 Common Issues
**App starts but database unavailable**:
- Check PostgreSQL container logs: `docker logs messenger-postgres`
- Verify env vars in `/opt/messenger/.env`
- Check network: `docker network inspect messenger-network`

**Cannot connect to port 8080**:
- Verify security group allows 8080
- Check Docker Compose port mapping
- Check app is listening on 0.0.0.0:8080

**Cloud-init fails**:
- Check YAML syntax validity
- Review serial console logs
- Verify template variables substituted correctly

### 17.2 Debug Commands
```bash
# VM access via serial console
yc compute connect-to-serial-port <instance-id>

# Check service status
sudo systemctl status messenger

# View logs
sudo docker compose -f /opt/messenger/docker-compose.yml logs

# Test database connection
psql -h localhost -U messenger -d messenger

# Check environment
cat /opt/messenger/.env
```

## 18. Future Enhancements

### 18.1 Features
- Group chats (many-to-many relationships)
- File attachments (S3 integration)
- Message encryption (E2E)
- Push notifications (Firebase/APNs)
- Message search (PostgreSQL full-text)
- Rate limiting
- Admin dashboard

### 18.2 Scaling
- Separate PostgreSQL to managed service (Yandex Managed PostgreSQL)
- Multiple app instances behind load balancer
- Redis for WebSocket pub/sub
- Read replicas for database

### 18.3 Monitoring
- Prometheus metrics
- Grafana dashboards
- AlertManager for incidents
- Structured logging (JSON)
- Distributed tracing (Jaeger)

## 19. Modification Guidelines

When modifying this project, maintain:
1. **Statelessness**: No server-side sessions
2. **Graceful degradation**: App starts without DB
3. **Security**: JWT, bcrypt, prepared statements
4. **Immutable infrastructure**: Recreate, don't mutate
5. **12-factor app**: Config via env vars
6. **API compatibility**: Version endpoints if breaking changes

### 19.1 Adding New Endpoints
1. Add handler to `internal/http/handler.go`
2. Add business logic to `internal/service/`
3. Add repository method if needed
4. Update API docs in this spec
5. Add tests

### 19.2 Changing Database Schema
1. Create new migration file in `migrations/`
2. Update `init.sql` for fresh deployments
3. Test migration on staging
4. Ensure backward compatibility (or coordinate frontend)
5. Update model structs

### 19.3 Infrastructure Changes
1. Update Terraform modules
2. Test with `terraform plan`
3. Update cloud-init if needed
4. Test deployment in dev environment
5. Document changes in this spec

## 20. Contact & Support

- **Repository**: GitHub
- **Issues**: GitHub Issues
- **Documentation**: This file + README.md
- **Deployment Guide**: DEPLOY.md

---

**Version**: 1.0  
**Last Updated**: 2026-02-03  
**Maintainer**: AI Assistant
