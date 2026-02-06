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
- Automatic default user creation on startup
- New chat creation with user filtering
- **Telegram-like UI**: Two-panel layout with chat list and message bubbles

### 1.3 Architecture Principles
- **Stateless**: JWT tokens only, no sessions
- **Scalable**: Multi-tier architecture with load balancer and auto-scaling
- **High Availability**: Minimum 2 VMs, managed database with backups
- **Secure**: Network segmentation, TLS everywhere, least privilege access
- **Cloud-native**: Uses Yandex Managed Services (PostgreSQL, ALB)
- **Zero-downtime deployments**: Rolling updates via Instance Group

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
- **Styling**: White background (#fff), black text (#000) for high contrast
- **Font**: Chicago Regular font applied to all UI elements including inputs and messages

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
│   ├── app/app.go             # Application initialization, dependency injection, default user seeding
│   ├── auth/
│   │   ├── service.go         # JWT token generation/validation + user validation (username 5-16 chars, password min 5)
│   │   └── middleware.go      # HTTP auth middleware
│   ├── config/config.go       # Configuration from env vars (includes DEFAULT_USER, DEFAULT_PASSWORD, DOMAIN)
│   ├── http/handler.go        # HTTP REST handlers + new endpoints (/api/users, /api/conversations)
│   ├── model/
│   │   ├── user.go            # User entity
│   │   └── message.go         # Message entity
│   ├── service/
│   │   ├── user.go            # User business logic + GetAll()
│   │   └── message.go         # Message business logic + GetConversationPartners()
│   ├── storage/
│   │   ├── interfaces.go      # Repository interfaces (updated with GetAll, GetConversationPartners)
│   │   └── postgres/          # PostgreSQL implementations
│   │       └── storage.go     # Storage + UserRepo + MessageRepo (updated methods)
│   └── ws/
│       ├── handler.go         # WebSocket HTTP handler (accepts all origins)
│       └── hub.go             # WebSocket connection manager
├── web/                        # Frontend files (white background, black text styling)
│   ├── index.html             # Main HTML (includes New Chat modal)
│   ├── app.js                 # JavaScript application (dynamic contacts, user filtering, optimistic messages)
│   ├── style.css              # Styles (white bg, black text, Chicago font)
│   └── fonts/                 # Chicago Regular font files
├── migrations/
│   ├── 001_init.sql           # Database schema
│   └── 002_username_case_insensitive.sql  # Case-insensitive username index
├── terraform/                  # Infrastructure (ALB, Instance Group, Managed PostgreSQL)
│   ├── network/               # VPC with 3 subnets (public, app, db)
│   ├── alb/                   # Application Load Balancer with HTTPS
│   ├── compute/               # Instance Group with auto-scaling
│   ├── database/              # Yandex Managed PostgreSQL
│   └── envs/dev/              # Environment configuration
├── docker-compose.yml         # Local development (with local PostgreSQL)
├── Dockerfile                 # Application image (Go app only, no PostgreSQL)
└── .github/workflows/         # CI/CD
    └── deploy.yml
```

## 4. Data Models

### 4.1 User
```go
type User struct {
    ID           uuid.UUID `json:"id"`
    Username     string    `json:"username"`         // 5-16 characters
    PasswordHash string    `json:"-"`                // Never exposed in JSON
    CreatedAt    time.Time `json:"created_at"`
}
```

### 4.2 Message
```go
type Message struct {
    ID         uuid.UUID `json:"id"`
    SenderID   uuid.UUID `json:"sender_id"`
    ReceiverID uuid.UUID `json:"receiver_id"`
    Payload    []byte    `json:"payload"`          // Opaque binary data
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

### 5.2 Validation Rules
- **Username**: 5-16 characters
- **Password**: Minimum 5 characters

### 5.3 Endpoints

#### POST /api/auth/register
Register new user with validation.
```json
// Request
{
  "username": "string",    // 5-16 characters
  "password": "string"     // Minimum 5 characters
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
  "error": "username must be between 5 and 16 characters"
}
// or
{
  "error": "password must be at least 5 characters"
}
// or
{
  "error": "username already taken"
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

#### GET /api/users
Get list of all users or search by username (requires auth). Used for "New Chat" functionality.
```json
// Query params: ?username=<username>

// Response 200 (without query - all users, exclude self)
[
  {
    "id": "uuid",
    "username": "string",
    "created_at": "timestamp"
  }
]

// Response 200 (with username query - single user)
{
  "id": "uuid",
  "username": "string",
  "created_at": "timestamp"
}

// Response 404 (username not found)
{
  "error": "user not found"
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

#### GET /api/me
Get current user info from JWT token (requires auth).
```json
// Response 200
{
  "id": "uuid",
  "username": "string"
}
```

#### GET /api/conversations
Get list of user IDs with whom the current user has conversations (requires auth).
```json
// Response 200
[
  "uuid",
  "uuid",
  ...
]
```

#### GET /api/chats
Get formatted chat list with user info and last message preview (requires auth). Used for sidebar chat list.
```json
// Response 200
[
  {
    "user_id": "uuid",
    "username": "string",
    "last_message": "text content decoded from payload",
    "last_message_time": "2026-02-03T15:30:00Z"
  }
]
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
| DB_HOST | Managed PostgreSQL host | - | Yes |
| DB_PORT | PostgreSQL port | `6432` | No |
| DB_USER | PostgreSQL user | - | Yes |
| DB_PASSWORD | PostgreSQL password | - | Yes |
| DB_NAME | PostgreSQL database name | - | Yes |
| DB_SSLMODE | SSL mode | `require` | No |
| DOMAIN | Domain name for HTTPS | - | Yes |
| DEFAULT_USER | Default username to create on startup | - | No |
| DEFAULT_PASSWORD | Default password for default user | - | No |

### 6.2 Default User Seeding
If `DEFAULT_USER` and `DEFAULT_PASSWORD` are set:
1. App checks if user exists on startup
2. If not exists, creates user with bcrypt hashed password
3. Logs creation or "already exists" message
4. Does not fail startup on error

### 6.3 Database Connection String Format (Managed PostgreSQL)
```
host=<managed_db_host> port=6432 user=<user> password=<password> dbname=<name> sslmode=require
```

**Note**: Managed PostgreSQL requires SSL (`sslmode=require`) and uses port 6432.

## 7. Component Details

### 7.1 Application Initialization (internal/app/app.go)
1. Connect to **Yandex Managed PostgreSQL** (SSL required)
2. Initialize repositories
3. Create services (auth, user, message)
4. Setup WebSocket hub
5. Build HTTP router with middleware
6. Add health check endpoint (for ALB)
7. **Seed default user** if DEFAULT_USER/DEFAULT_PASSWORD configured

**Note**: Application now requires Managed PostgreSQL to start (no graceful degradation).

### 7.2 Authentication Service (internal/auth/service.go)
- **Methods**:
  - `Register(username, password) (*User, error)` - with validation (username 5-16 chars, password min 5)
  - `Login(username, password) (token string, err error)`
  - `ValidateToken(token string) (userID uuid.UUID, err error)`
  - `HashPassword(password string) (string, error)`
  - `CheckPassword(password, hash string) bool`
- **Validation Rules**:
  - Username: 5-16 characters
  - Password: Minimum 5 characters
- **Password Hashing**: bcrypt with default cost
- **JWT Claims**: `sub` (user ID), `exp` (expiration)

### 7.3 WebSocket Hub (internal/ws/hub.go)
- **Purpose**: Manages all active WebSocket connections
- **Features**:
  - User ID → Connection mapping
  - Broadcast to specific user
  - Automatic reconnection support
  - Heartbeat/ping-pong (60s read timeout, 54s ping interval)
  - **Accepts all origins** for cloud deployment flexibility
- **Message Flow**:
  1. Client connects with JWT token via query param: `?token=<jwt>`
  2. Hub stores connection mapped to user ID
  3. Incoming messages routed by receiver_id
  4. If receiver offline, message stored in DB for later delivery
  5. Optimistic message confirmation replaces temporary gray message

### 7.4 Storage Layer (internal/storage/postgres/)
**Storage struct**:
- Manages pgxpool.Pool
- Provides User() and Message() repositories
- Transaction support via WithTx()

**UserRepo**:
- `Create(ctx, *User) error`
- `GetByID(ctx, uuid) (*User, error)`
- `GetByUsername(ctx, string) (*User, error)`
- `GetAll(ctx) ([]User, error)` - NEW: returns all users for "New Chat" feature

**MessageRepo**:
- `Create(ctx, *Message) error`
- `GetByUserPair(ctx, user1, user2, limit, offset) ([]Message, error)`
- `GetConversationPartners(ctx, userID) ([]uuid.UUID, error)` - NEW: returns IDs of users with conversations

### 7.5 HTTP Handlers (internal/http/handler.go)
- User registration/login with validation
- **NEW**: `GET /api/users` - List all users
- **NEW**: `GET /api/conversations` - List conversation partners
- Authenticated message endpoints
- JWT middleware injection
- Static file serving (web/)

## 8. Frontend Specification

### 8.1 Features
- User registration and login
- Real-time messaging via WebSocket
- **Telegram-like Two-Panel Layout**:
  - Left sidebar: Chat list with avatars, usernames, message previews, timestamps
  - Right panel: Active chat window with message bubbles
- **Dynamic Contact List**: Loaded from `GET /api/chats` endpoint, sorted by last message time
- Message history loading
- Auto-reconnect on disconnect
- Smart timestamp formatting (Today: HH:MM, Yesterday, or MMM DD)
- Auto-resizing message input
- "New Chat" button with search and filtering modal
- User filtering (exclude self and existing conversations)

### 8.2 Layout Structure
```
+-----------------------------------------------+
|  Chats    +   |  [Avatar] Username           |
|  Sidebar      |                               |
|               |  [Message bubbles]            |
|  • User1     |                               |
|    Preview   |  [Blue bubble - me]          |
|    15:30     |                               |
|              |  [Gray bubble - other]       |
|  • User2     |                               |
|    Preview   |  [Type message...]  [Send]    |
|    Yesterday |                               |
+----------------+-------------------------------+
```

### 8.3 Local Storage Keys
- `token` - JWT token
- `userId` - Current user UUID

### 8.4 WebSocket Protocol
1. Connection: `ws://host/ws?token=<jwt>`
2. On open: Log to console
3. On message: Parse JSON, display in UI, update chat list
4. On close: Reconnect after 3 seconds
5. Send: JSON with receiver_id and payload array

### 8.5 Chat List (Left Sidebar)
- **Header**: "Chats" title + "+" button for new chat
- **Chat Items** (sorted by last message time, newest first):
  - Avatar circle with first letter of username
  - Username (bold)
  - Last message preview (truncated)
  - Timestamp with smart formatting:
    - Today: "HH:MM" (e.g., "15:30")
    - Yesterday: "Yesterday"
    - Older: "MMM DD" (e.g., "Feb 28")
- **Empty List**: When no chats exist, shows "New Chat" button at bottom
- **Footer**: Current user name + Logout button

### 8.6 Chat Window (Right Panel)
- **Header**: Avatar + Username + Status
- **Messages Area**: Scrollable container with bubbles
  - **Incoming (other)**: Left-aligned, white background (#fff), black text, rounded corners
  - **Outgoing (me)**: Right-aligned, white background (#fff), black text, rounded corners
  - **Optimistic messages**: Gray text (#999999) while sending, replaced by black text after confirmation
  - **Message confirmation**: Temporary gray message replaced by confirmed message from server
  - **Timestamp**: Small gray text below message (local time)
    - Same day: "HH:MM" ("15:30")
    - Different day: "MMM DD, HH:MM" ("Feb 28, 15:30")
- **Input Area**: Auto-resizing textarea + Send button
- **Empty State**:
  - When no chats exist, right panel shows blank white space
  - No icons, no text, no buttons in empty state
  - "New Chat" button in sidebar (normal position)
  - "New Chat" button displayed at bottom of contacts list when empty

### 8.7 New Chat Modal
1. Click "+" button in sidebar
2. Modal opens with single username input field
3. User types username and:
   - Presses Enter key, OR
   - Clicks "Create Chat" button
4. Validation:
   - If username empty: Show "Username required" error below input
   - If user not found: Show "User not found" error below input
   - If user exists: Create new chat and open it
   - If chat already exists with user: Open existing chat
5. Errors displayed below input in black text
6. "Cancel" button closes modal without action

### 8.8 Timezone & Localization
- All timestamps converted to browser's local time
- Uses `Intl.DateTimeFormat` for formatting
- English only for all UI text

### 8.9 Styling
- **Background**: White (#ffffff) for all containers
- **Text**: Black (#000000) for primary text
- **Font**: Chicago Regular for all UI elements including inputs and textareas
- **Error Messages**: Black color (#000000) for all error text
- **Secondary Text**: Gray (#666666 or #999999) for less important elements:
  - Timestamps
  - Placeholder text
  - Hints
  - Status indicators
- **All User-Facing Text**: English only, no translations
- **Message Bubbles**:
  - All messages: White bg (#fff), black text, 1px black border (#000)
  - Optimistic (sending): Gray text (#999999), white bg
- **Active Chat**: Black background (#000) with white text in sidebar
- **Hover States**: Light gray (#f5f5f5)
- **Borders**: Light gray (#e0e0e0) 1px, or black (#000000) 2px for emphasis
- **Buttons**:
  - Primary: Black bg, white text
  - Secondary: White bg, black border, black text
- **Avatars**: Black circle (#000) with white initial letter
- **Scrollbars**: Thin gray (#cccccc) with rounded corners

## 9. Docker Configuration

### 9.1 Dockerfile (Multi-stage)
```dockerfile
# Stage 1: Build
FROM golang:1.21-alpine AS builder
RUN apk add --no-cache git ca-certificates tzdata
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod tidy && go mod download
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

**Note**: Local development uses containerized PostgreSQL. Production uses **Yandex Managed PostgreSQL** (external service).

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
      DEFAULT_USER: admin
      DEFAULT_PASSWORD: admin123
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

### 9.3 Production Deployment (cloud-init)
- Install Docker
- Create `/opt/messenger/` directory
- Write `.env` file with secrets (including DEFAULT_USER, DEFAULT_PASSWORD)
- Write `docker-compose.yml` with **only Application** (no PostgreSQL)
- Systemd service to manage docker container
- Application connects to **Yandex Managed PostgreSQL**
- Restart policy: unless-stopped

## 10. Infrastructure (Terraform) - Scalable Architecture

### 10.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Internet                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS (443)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           Yandex Application Load Balancer (ALB)            │
│  • TLS Termination (Let's Encrypt or imported certificate)  │
│  • HTTP → HTTPS redirect                                    │
│  • Health checks: /api/health                              │
│  • Sticky sessions for WebSocket (optional)                │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP (8080)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Yandex Compute Instance Group                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   VM 1       │  │   VM 2       │  │   VM N       │      │
│  │  (App Only)  │  │  (App Only)  │  │  (App Only)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  Min: 2 VMs, Max: Auto-scaling                             │
└──────────┬──────────────────────────────────────────────────┘
           │ PostgreSQL (6432)
           │ SSL Mode: require
           ▼
┌─────────────────────────────────────────────────────────────┐
│          Yandex Managed Service for PostgreSQL              │
│  • Version: 15                                             │
│  • Network: Same VPC (private subnet)                      │
│  • Access: Only from application subnet                    │
│  • SSL: Required                                           │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 Components

#### 1. Network Module
- **VPC**: CIDR `10.0.0.0/16`
- **Subnets**:
  - `10.0.1.0/24` - Application subnet (ru-central1-a)
  - `10.0.2.0/24` - Database subnet (ru-central1-a)
- **Security Groups**:
  - **ALB SG**: Ingress 443 from 0.0.0.0/0, Egress all
  - **App SG**: Ingress 8080 from ALB subnet only, Egress all to DB subnet
  - **DB SG**: Ingress 6432 from App subnet only, Egress none

#### 2. Application Load Balancer (ALB)
- **Listener**: HTTPS (443) with TLS 1.2+
- **Backend Group**: Instance Group with HTTP (8080)
- **Health Check**: GET /api/health every 5s
- **Timeout**: 10s connection, 60s request
- **Domain**: Configurable via `DOMAIN` variable

#### 6. SSL/TLS Certificates (Let's Encrypt)
- **Service**: Yandex Certificate Manager with Let's Encrypt
- **Type**: Managed certificate (auto-renewal)
- **Challenge**: DNS-01 (DNS_CNAME)
- **Validation**: Requires CNAME DNS record for domain ownership
- **Auto-renewal**: Every 90 days automatically
- **Status Tracking**: Terraform outputs show certificate status

**Certificate Lifecycle:**
1. Terraform creates `yandex_cm_certificate` resource
2. Certificate Manager generates DNS challenge
3. User adds CNAME record to DNS (provided in terraform output)
4. Let's Encrypt validates domain ownership via DNS
5. Certificate status changes to `ISSUED`
6. ALB uses certificate for HTTPS termination
7. Auto-renewal before expiration

#### 3. Compute Instance Group
- **Image**: Container-Optimized Image with Docker
- **Type**: standard-v3 (2 cores, 4GB RAM, 20GB SSD)
- **Min Size**: 2 VMs (high availability)
- **Max Size**: Configurable (default: 4)
- **Auto-healing**: Recreate VM on health check failure
- **Auto-scaling**: Based on CPU/memory (optional)

#### 4. Managed PostgreSQL
- **Service**: Yandex Managed Service for PostgreSQL
- **Version**: 15
- **Configuration**: 
  - s2.micro (2 vCPU, 8GB RAM) or higher
  - 20GB SSD storage
- **Network**: Private subnet (10.0.2.0/24)
- **Security**: 
  - SSL required (sslmode=require)
  - No public access
  - Access only from application subnet
- **Backup**: Daily automatic backups
- **High Availability**: Optional master-replica

#### 5. DNS Configuration
- **Provider**: External (Cloudflare, Route53, etc.) or Yandex DNS
- **Record Type**: A or CNAME pointing to ALB IP
- **Domain**: Configured via `DOMAIN` environment variable
- **Certificate**: Let's Encrypt (auto) or imported

### 10.3 Security Groups Detail

#### ALB Security Group
```
Ingress:
  - 0.0.0.0/0:443 (HTTPS)
  
Egress:
  - 10.0.1.0/24:8080 (to App VMs)
```

#### Application Security Group
```
Ingress:
  - 10.0.0.0/16:8080 (from ALB only)
  
Egress:
  - 10.0.2.0/24:6432 (to PostgreSQL)
  - 0.0.0.0/0:443 (for Docker pulls, HTTPS)
```

#### Database Security Group
```
Ingress:
  - 10.0.1.0/24:6432 (from App VMs only)
  
Egress:
  - None (managed service)
```

### 10.4 VM Lifecycle Strategy
- **Instance Group**: Managed by Yandex Compute
- **Rolling Updates**: Replace VMs one by one during deployment
- **Health Checks**: VM removed from LB if unhealthy
- **Auto-healing**: Automatic recreation of failed VMs
- **Immutable**: Each VM is stateless, ephemeral

### 10.5 Cloud-init Stages
1. Update packages
2. Configure Docker
3. Login to Docker Hub (if private registry)
4. Pull application image
5. Create systemd service for container
6. Start application with env vars from metadata
7. Register with ALB via health checks

### 10.6 Variables
| Name | Type | Default | Description |
|------|------|---------|-------------|
| yc_token | string | - | YC OAuth token |
| yc_cloud_id | string | - | YC Cloud ID |
| yc_folder_id | string | - | YC Folder ID |
| zone | string | ru-central1-a | Availability zone |
| docker_image | string | - | Docker image URL |
| jwt_secret | string | - | JWT signing secret |
| db_host | string | - | Managed PostgreSQL host |
| db_port | string | `6432` | PostgreSQL port |
| db_user | string | - | PostgreSQL user |
| db_password | string | - | PostgreSQL password |
| db_name | string | - | PostgreSQL database name |
| db_sslmode | string | `require` | PostgreSQL SSL mode |
| http_addr | string | `:8080` | Server bind address |
| default_user | string | - | Default username for seeding |
| default_password | string | - | Default password for seeding |
| domain | string | - | Domain name for ALB |
| cert_type | string | `letsencrypt` | Certificate type (letsencrypt/imported) |

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
   - Terraform apply (rolling update via Instance Group)
   - ALB automatically registers new VMs
   - Zero-downtime deployment
   - Output ALB IP and domain

### 11.2 Required Secrets
- `DOCKERHUB_USERNAME` - Docker Hub username
- `DOCKERHUB_TOKEN` - Docker Hub access token
- `YC_TOKEN` - Yandex Cloud OAuth token
- `YC_S3_ACCESS_KEY` - S3 backend access key
- `YC_S3_SECRET_KEY` - S3 backend secret key
- `TF_STATE_BUCKET` - Terraform state bucket name
- `JWT_SECRET` - JWT signing secret
- `DB_PASSWORD` - Managed PostgreSQL password
- `DEFAULT_USER` - Default username for seeding
- `DEFAULT_PASSWORD` - Default password for seeding

### 11.3 Required Variables
- `YC_CLOUD_ID` - Yandex Cloud ID
- `YC_FOLDER_ID` - Yandex Folder ID
- `DOMAIN` - Domain name for application (e.g., messenger.example.com)
- `DB_HOST` - Managed PostgreSQL host (from Yandex Console)
- `DB_PORT` - PostgreSQL port (default: 6432)
- `DB_USER` - PostgreSQL username
- `DB_NAME` - PostgreSQL database name
- `DB_SSLMODE` - SSL mode (default: require)
- `HTTP_ADDR` - Server bind address (default: :8080)
- `JWT_DURATION` - Token lifetime (default: 24h)
- `MIN_INSTANCES` - Minimum VM count (default: 2)
- `MAX_INSTANCES` - Maximum VM count (default: 4)

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
- Yandex Cloud (compute, network, ALB, managed database)
- Yandex Managed Service for PostgreSQL 15
- DNS Provider (for domain configuration)
- Let's Encrypt (TLS certificates)

## 13. Error Handling

### 13.1 HTTP Status Codes
- 200: Success
- 201: Created
- 400: Bad Request (validation error)
- 401: Unauthorized (invalid/missing token)
- 404: Not Found
- 500: Internal Server Error

### 13.2 Validation Errors (400)
- `Username required`
- `User not found`
- `username must be between 5 and 16 characters`
- `password must be at least 5 characters`
- `username already taken`
- `receiver not found`

### 13.3 Error Response Format
```json
{
  "error": "human readable message in English"
}
```

### 13.4 Graceful Degradation
- If PostgreSQL unavailable: App fails to start (Managed PostgreSQL is required)
- Health endpoint returns 503 when DB down
- ALB removes unhealthy VMs from rotation
- Auto-healing recreates failed VMs automatically
- Default user seeding failure does not block startup

## 14. Security Considerations

### 14.1 Authentication
- JWT tokens with HS256 signing
- 24h default expiration (configurable)
- bcrypt password hashing (adaptive cost)
- No sensitive data in JWT payload
- **Validation**: Username 5-16 chars, password min 5 chars

### 14.2 Database
- Prepared statements via pgx (SQL injection protection)
- Password never logged or exposed in API
- SSL mode configurable (disable/dev/prod)
- Connection pooling (pgxpool)

### 14.3 Infrastructure
- **Network Segmentation**:
  - ALB in DMZ (public subnet)
  - App VMs in private subnet
  - PostgreSQL in isolated database subnet
- **Security Groups**: Restrictive rules (least privilege)
  - PostgreSQL accessible only from app subnet
  - App VMs accessible only from ALB
  - No direct public access to VMs or DB
- **TLS**: End-to-end encryption
  - HTTPS (443) from clients to ALB
  - HTTP (8080) from ALB to VMs (internal network)
  - SSL (6432) from VMs to PostgreSQL
- **Secrets**: All credentials via GitHub Secrets, never in code
- **Terraform State**: Encrypted in S3 bucket

## 15. Testing Strategy

### 15.1 Unit Tests
- Authentication service (token generation/validation)
- Password hashing (bcrypt)
- Repository methods (mocked DB)
- Validation logic (username/password length)

### 15.2 Integration Tests
- Full HTTP API flow
- WebSocket connection and message routing
- Database migrations
- Default user seeding on startup

### 15.3 End-to-End
- Docker Compose local deployment
- Terraform plan validation
- CI/CD pipeline dry-run
- "New Chat" flow testing

## 16. Deployment Checklist

### 16.1 First Deployment - Scalable Architecture

#### Prerequisites
1. Create Yandex Cloud account
2. Get YC_TOKEN via OAuth
3. Create S3 bucket for Terraform state
4. Create service account with storage.editor role
5. Generate S3 access keys
6. Configure DNS domain (e.g., messenger.example.com)

#### Infrastructure Setup
7. Set all GitHub Secrets (see Section 11.2)
8. Set all GitHub Variables (see Section 11.3)
9. Push to main branch
10. Terraform creates:
    - VPC with 3 subnets (public, app, db)
    - Security groups with restricted access
    - Yandex Managed PostgreSQL (private subnet)
    - Application Load Balancer with HTTPS
    - Instance Group with 2+ VMs
11. Verify in Actions logs
12. Configure DNS: Point domain to ALB IP address
13. Wait for Let's Encrypt certificate provisioning
14. Test endpoints:
    - HTTPS: `https://<domain>/api/health`
    - WebSocket: `wss://<domain>/ws`
15. Verify default user created (if configured)

### 16.2 Subsequent Deployments
1. Push changes to main
2. CI/CD automatically builds new Docker image
3. Terraform rolling update via Instance Group:
   - Creates new VM with updated image
   - Waits for health check
   - Removes old VM from LB
   - Repeats for all VMs
4. Zero-downtime deployment complete
5. Verify in browser: `https://<domain>`

## 17. Troubleshooting

### 17.1 Common Issues - Scalable Architecture

**ALB shows no healthy backends**:
- Check Instance Group health: Yandex Console → Compute → Instance Groups
- Verify VMs are running and passing health checks
- Check security groups: App SG must allow 8080 from ALB subnet
- Review VM logs via serial console

**Cannot connect to PostgreSQL**:
- Verify DB_HOST points to Managed PostgreSQL (not localhost)
- Check DB_SG allows 6432 from App subnet only
- Verify SSL mode is set to "require"
- Test connection from VM: `psql -h <db_host> -U <user> -d <db>`

**Certificate not issued**:
- Verify DNS A record points to ALB IP
- Check domain variable matches DNS record
- Allow 5-10 minutes for Let's Encrypt validation
- For imported certs, verify certificate chain

**WebSocket connection fails**:
- Ensure connecting via `wss://` (not `ws://`)
- Check ALB supports WebSocket protocol
- Verify JWT token is valid and not expired

**Auto-scaling not working**:
- Check Instance Group settings in Yandex Console
- Verify target CPU/memory metrics
- Review scaling policies

### 17.2 Debug Commands
```bash
# Check ALB status
yc alb load-balancer list
yc alb backend-group list

# Check Instance Group
yc compute instance-group list
yc compute instance-group get <group-id>

# VM access via serial console
yc compute connect-to-serial-port <instance-id>

# Check container logs on VM
sudo docker logs messenger-app

# Test database connection from VM
psql "host=<db_host> port=6432 user=<user> dbname=<db> sslmode=require"

# Check environment
cat /opt/messenger/.env

# View ALB logs (if enabled)
yc logging read --group-id=<log-group-id>
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
- User avatars
- Message read receipts

### 18.2 Scaling (Implemented)
- ✅ Separate PostgreSQL to managed service (Yandex Managed PostgreSQL)
- ✅ Multiple app instances behind load balancer (ALB)
- Redis for WebSocket pub/sub (future)
- Read replicas for database (future)

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
7. **Validation**: Username 5-16 chars, password min 5 chars

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

### 19.4 Adding Frontend Features
1. Update `web/index.html` for structure
2. Update `web/style.css` for styling (maintain white bg, black text)
3. Update `web/app.js` for logic
4. Test responsive design
5. Update this spec's Frontend section

## 20. Contact & Support

- **Repository**: GitHub
- **Issues**: GitHub Issues
- **Documentation**: This file + README.md
- **Deployment Guide**: DEPLOY.md

---

**Version**: 2.0
**Last Updated**: 2026-02-05
**Maintainer**: AI Assistant

## Changelog

### Version 2.1 (2026-02-05) - Automatic SSL Certificates
- **Let's Encrypt Integration**: Automatic SSL certificate provisioning
  - **Yandex Certificate Manager**: Managed Let's Encrypt certificates
  - **DNS Challenge**: DNS-01 validation via CNAME records
  - **Auto-renewal**: Certificates automatically renew every 90 days
  - **Terraform Integration**: Certificate creation and validation via Terraform
  - **CI/CD Updates**: Pipeline outputs DNS challenge records for easy configuration
- **Documentation**: Updated DEPLOY.md with detailed DNS setup instructions
- **Outputs**: New terraform outputs for certificate status and DNS records

### Version 2.0 (2026-02-05) - Scalable Architecture
- **Infrastructure Overhaul**: Moved from single VM to scalable multi-tier architecture
  - **Application Load Balancer (ALB)**: HTTPS termination with automatic certificate management
  - **Instance Group**: Minimum 2 VMs with auto-scaling support
  - **Yandex Managed PostgreSQL**: External managed database in private subnet
  - **Network Segmentation**: 3-tier architecture (DMZ, App, DB subnets)
  - **Security**: Restrictive security groups (least privilege principle)
- **DNS Support**: Added `DOMAIN` variable for custom domain configuration
- **TLS/SSL**: End-to-end encryption (HTTPS + PostgreSQL SSL)
- **Zero-downtime deployments**: Rolling updates via Instance Group
- **Removed**: PostgreSQL from Docker container (now external service)
- **Updated**: All connection strings for Managed PostgreSQL
- **Updated**: Security groups to restrict database access

### Version 1.4 (2026-02-05)
- **Bug Fixes**:
  - Fixed WebSocket connection issues on cloud deployment (changed CheckOrigin to accept all origins)
  - Fixed message duplication: optimistic messages now show gray text, replaced by confirmed black text
  - Fixed route ordering: WebSocket endpoint registered before static file catch-all
- **UI Updates**:
  - All messages now have white background with black text
  - Optimistic messages show gray text (#999999) while sending
  - Applied Chicago font to all text elements including inputs and textareas
- **Backend Updates**:
  - WebSocket payload type changed from []byte to string for consistency
  - Removed unused imports

### Version 1.3 (2026-02-03)
- **UI Cleanup**: Removed title and input limitation hints from authentication screen
- **Enhanced API**: Added `GET /api/me` endpoint for current user info
- **Updated API**: Enhanced `GET /api/users` endpoint with `?username=` query parameter support
- **New Chat Modal Redesign**:
  - Simplified to username-only input (no user list)
  - Enter key and "Create Chat" button both submit
  - Errors displayed below input
  - "User not found" and "Username required" validation
- **Empty State Redesign**: Blank white window when no chats exist
  - No icons or text in empty chat area
  - "New Chat" button in normal sidebar position
  - Button displayed at bottom of contacts list when empty
- **Styling Updates**:
  - Error messages: Black color (#000000)
  - Secondary text: Gray (#666666/#999999) for timestamps, placeholders, hints
  - All UI text: English only

### Version 1.2 (2026-02-03)
- **Major UI Redesign**: Telegram-like two-panel interface
  - Left sidebar: Chat list with avatars, usernames, message previews, timestamps
  - Right panel: Chat window with message bubbles, input area, header
  - Message bubbles: Outgoing (blue bg, white text) / Incoming (gray bg, black text)
- **New API Endpoint**: `GET /api/chats` - Returns formatted chat list with last message data
- **Enhanced Storage**: `GetChatList()` method for efficient chat list queries
- **Frontend Features**:
  - Local time conversion for all timestamps
  - Smart time formatting (Today: HH:MM, Yesterday, or MMM DD)
  - Auto-resizing message input
  - Smooth animations and transitions
  - Responsive design for mobile
  - Enhanced "New Chat" modal with search and filtering
  - Optimistic message sending with gray→black text transition
  - Chicago font applied to all UI elements

### Version 1.1 (2026-02-03)
- Added validation: username 5-16 characters, password minimum 5 characters
- Added default user seeding (DEFAULT_USER, DEFAULT_PASSWORD)
- Added new API endpoints: GET /api/users, GET /api/conversations
- Added storage methods: GetAll(), GetConversationPartners()
- Updated frontend: white background, black text styling
- Added "New Chat" functionality with user filtering
- Updated Terraform: unique VM naming with timestamp, new variables
- Updated CI/CD: DEFAULT_USER and DEFAULT_PASSWORD secrets
