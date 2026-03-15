# Agent Guide - Messenger Project

## Оглавление

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Project Structure](#4-project-structure)
5. [Core Components](#5-core-components)
6. [API Endpoints](#6-api-endpoints)
7. [WebSocket Protocol](#7-websocket-protocol)
8. [Database Schema](#8-database-schema)
9. [Configuration](#9-configuration)
10. [Deployment](#10-deployment)
11. [Development Workflow](#11-development-workflow)
12. [Common Tasks](#12-common-tasks)

---

## 1. Project Overview

Production-ready messenger backend with:
- REST API + WebSocket real-time messaging
- JWT authentication (stateless)
- 1-to-1 messaging (no group chats)
- AES-256-GCM message encryption
- PostgreSQL persistence
- Two deployment options: **Min** (single VM) and **Dev** (scalable)

---

## 2. Architecture

```
Client (Browser)
    ↓ HTTPS/WSS
ALB (Dev) / Caddy (Min)
    ↓ HTTP
Instance Group / Single VM
    ↓
Go Application (Docker)
    ↓ PostgreSQL (SSL)
Yandex Managed PostgreSQL / Docker Container
```

---

## 3. Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.21+, Gorilla Mux, Gorilla WebSocket |
| Database | PostgreSQL 15+ with pgx |
| Auth | JWT (HS256), bcrypt |
| Encryption | AES-256-GCM |
| Frontend | Vanilla JS, HTML, CSS |
| Infra | Docker, Terraform, Yandex Cloud |

---

## 4. Project Structure

```
internal/
├── app/          # App initialization, DI, seeding
├── auth/         # JWT service + middleware
├── config/       # Environment config
├── crypto/       # AES-256-GCM encryptor
├── http/         # REST handlers
├── model/        # Data models
├── service/      # Business logic
├── storage/      # Repository interfaces + implementations
├── migrations/   # Embedded SQL migrations
└── ws/           # WebSocket hub + handlers

web/              # Frontend (HTML, CSS, JS)
terraform/        # IaC (network, compute, database)
```

---

## 5. Core Components

### 5.1 Authentication Service ([`internal/auth/service.go`](internal/auth/service.go))
- `Register(username, password)` - with validation (5-16 chars, latin+digits)
- `Login(username, password)` - returns JWT token
- `ValidateToken(token)` - extracts user ID
- `HashPassword(password)` - bcrypt hashing
- `CheckPassword(password, hash)` - verify password

### 5.2 WebSocket Hub ([`internal/ws/hub.go`](internal/ws/hub.go))
- User ID → Connection mapping
- Broadcast to specific user
- Heartbeat: 60s read timeout, 54s ping interval
- Accepts all origins (for cloud deployment)

### 5.3 Message Encryption ([`internal/crypto/encryptor.go`](internal/crypto/encryptor.go))
- Algorithm: AES-256-GCM
- Key: 32 bytes from `ENCRYPTION_KEY` env var
- Returns base64-encoded ciphertext

---

## 6. API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register new user |
| POST | `/api/auth/login` | No | Authenticate user |
| POST | `/api/auth/change-password` | Yes | Change password |
| GET | `/api/users` | Yes | List users (search by username) |
| GET | `/api/users/{id}` | Yes | Get user by ID |
| GET | `/api/me` | Yes | Current user info |
| GET | `/api/conversations` | Yes | List conversation partners |
| GET | `/api/chats` | Yes | Chat list with last message |
| POST | `/api/messages` | Yes | Send message |
| GET | `/api/messages/{user_id}` | Yes | Message history |
| GET | `/ws` | Yes (query param) | WebSocket endpoint |
| GET | `/health` | No | Health check |

---

## 7. WebSocket Protocol

### Connection
```
ws://host/ws?token=<jwt>
```

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `message` | Client → Server | Send message |
| `message` | Server → Client | Incoming message |
| `pong` | Server → Client | Response to client ping |
| `read` | Client → Server | Mark chat as read |

### Client → Server Format
```json
{
  "receiver_id": "uuid",
  "payload": "message text"
}
```

### Server → Client Format
```json
{
  "id": "uuid",
  "sender_id": "uuid",
  "receiver_id": "uuid",
  "payload": "message text",
  "created_at": "timestamp"
}
```

---

## 8. Database Schema

### Tables
```sql
-- users
id UUID PRIMARY KEY
username VARCHAR(50) UNIQUE NOT NULL
password_hash VARCHAR(255) NOT NULL
created_at TIMESTAMP

-- messages
id UUID PRIMARY KEY
sender_id UUID NOT NULL
receiver_id UUID NOT NULL
payload BYTEA NOT NULL  -- AES-256-GCM encrypted
created_at TIMESTAMP

-- chat_reads (for unread tracking)
id UUID PRIMARY KEY
chat_id UUID NOT NULL
user_id UUID NOT NULL
last_read_at TIMESTAMP
```

---

## 9. Configuration

### Required Environment Variables
| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | JWT signing key (required) |
| `ENCRYPTION_KEY` | AES-256 key, min 32 chars (required) |
| `DB_HOST` | PostgreSQL host (required) |
| `DB_USER` | PostgreSQL user (required) |
| `DB_PASSWORD` | PostgreSQL password (required) |
| `DB_NAME` | PostgreSQL database (required) |
| `DOMAIN` | Domain for HTTPS (required) |

### Optional
| Variable | Default |
|----------|---------|
| `HTTP_ADDR` | `:8080` |
| `JWT_DURATION` | `24h` |
| `DB_PORT` | `6432` |
| `DB_SSLMODE` | `require` |
| `DEFAULT_USER` | - |
| `DEFAULT_PASSWORD` | - |

---

## 10. Deployment

### Min Deployment (Single VM)
- Location: `terraform/envs/min/`
- Cost: ~$7-8/month
- Components: VM + PostgreSQL container + Caddy
- Trigger: Push without `[dev]` tag

### Dev Deployment (Scalable)
- Location: `terraform/envs/dev/`
- Cost: ~$65-90/month
- Components: ALB + Instance Group + Managed PostgreSQL
- Trigger: Push with `[dev]` tag

---

## 11. Development Workflow

### Local Development
```bash
# Start with Docker Compose
docker-compose up -d

# Server connects to containerized PostgreSQL
```

### Production Deployment
```bash
# Build and push Docker image
docker build -t messenger:latest .
docker push messenger:latest

# Apply Terraform
cd terraform/envs/min && terraform apply
# or
cd terraform/envs/dev && terraform apply
```

---

## 12. Common Tasks

### Add New API Endpoint
1. Add handler to [`internal/http/handler.go`](internal/http/handler.go)
2. Add business logic to [`internal/service/`](internal/service/)
3. Add repository method if needed
4. Update [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md)

### Add New Database Migration
1. Create file: `internal/migrations/00X_name.sql`
2. Migrations auto-run on startup (embedded in binary)

### Add New WebSocket Message Type
1. Update [`internal/ws/hub.go`](internal/ws/hub.go) - add message type
2. Update [`internal/ws/handler.go`](internal/ws/handler.go) - add handler
3. Update frontend in [`web/app.js`](web/app.js)

### Add New Frontend Feature
1. Update [`web/index.html`](web/index.html) - structure
2. Update [`web/style.css`](web/style.css) - styling
3. Update [`web/app.js`](web/app.js) - logic

---

## Quick Reference

| Task | File(s) |
|------|---------|
| Authentication | [`internal/auth/`](internal/auth/) |
| HTTP Handlers | [`internal/http/handler.go`](internal/http/handler.go) |
| WebSocket | [`internal/ws/`](internal/ws/) |
| Database | [`internal/storage/postgres/`](internal/storage/postgres/) |
| Encryption | [`internal/crypto/encryptor.go`](internal/crypto/encryptor.go) |
| Frontend | [`web/`](web/) |
| Migrations | [`internal/migrations/`](internal/migrations/) |
| Config | [`internal/config/config.go`](internal/config/config.go) |

---

**Last Updated**: 2026-03-14  
**Version**: 2.7  
**Maintainer**: AI Assistant
