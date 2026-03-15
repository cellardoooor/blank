# Messenger Backend

Production-ready messenger backend on Go with PostgreSQL and WebSocket support.

## Features

### Backend
- REST API + WebSocket (real-time messaging)
- JWT authentication
- 1-to-1 messaging (no group chats)
- **Message Encryption**: AES-256-GCM encryption for all messages in database
- **Password Security**: bcrypt hashing for passwords
- **Auto-migrations**: Database schema created automatically on startup
- Stateless backend (ready for horizontal scaling)
- Docker support
- Terraform infrastructure for Yandex Cloud

### Frontend
- Custom Chicago font for all UI text
- **WebSocket Keep-Alive**: Ping/pong every 30s with exponential backoff reconnection
- **Unread Counter**: Shows total unread messages in tab title (e.g., "Blank (3)")
- **Relative Favicon Path**: Works correctly regardless of deployment path

## Deployment Options

| Option | Description | Cost | Use Case |
|--------|-------------|------|----------|
| **Min** | Single VM + PostgreSQL container + Caddy | ~$5-10/мес | Production, personal projects |
| **Dev** [dev] | ALB + Instance Group + Managed PostgreSQL | ~$65-90/мес | High-traffic, enterprise |

- **Min**: `/terraform/envs/min/` - минимальный деплой на одной VM
- **Dev**: `/terraform/envs/dev/` - масштабируемая архитектура (push с тегом `[dev]`)

See [DEPLOY_MIN.md](DEPLOY_MIN.md) for Min deployment, [DEPLOY.md](DEPLOY.md) for Dev deployment.

## Quick Start

### Local Development

```bash
# Clone repository
git clone <repo-url>
cd messenger

# Start dependencies (local PostgreSQL in Docker)
docker-compose up -d postgres

# Run application
go run cmd/server/main.go
```

### Build Docker Image

```bash
docker build -t cellardooor/blank:latest .
docker push cellardooor/blank:latest
```

## Project Structure

```
.
├── cmd/server/           # Application entry point
├── internal/
│   ├── app/             # Application initialization
│   ├── auth/            # JWT authentication
│   ├── config/          # Configuration
│   ├── http/            # HTTP handlers
│   ├── model/           # Data models
│   ├── service/         # Business logic
│   ├── storage/         # Data access layer
│   └── ws/              # WebSocket handlers
├── web/                 # Frontend static files (Chicago font)
├── terraform/           # Infrastructure as Code
│   ├── envs/
│   │   ├── min/         # Min deployment (own VPC, single VM)
│   │   └── dev/         # Dev deployment [dev] (ALB, Instance Group, Managed PostgreSQL)
│   └── network/         # Network module (for Dev only)
└── internal/migrations/ # Database migrations (embedded in binary)
```

## Architecture

### Min (Production)

```
Internet
    |
    | HTTPS (443)
    v
┌─────────────────────────────────────┐
│  Single VM (Ubuntu + Docker)        │
│  • Caddy (TLS + reverse proxy)      │
│  • App container (Go backend)       │
│  • PostgreSQL container             │
│  • Static IP + Data disk            │
└─────────────────────────────────────┘
```

### Dev [dev] (Scalable)

```
Internet
    |
    | HTTPS (443)
    v
┌─────────────────────────────────────┐
│  Yandex Application Load Balancer   │
│  • TLS Termination (Let's Encrypt)  │
└──────────────┬──────────────────────┘
                | HTTP (8080)
                v
┌─────────────────────────────────────┐
│  Yandex Compute Instance Group      │
│  • Min: 2 VMs, Max: 4 VMs           │
└──────────────┬──────────────────────┘
                | PostgreSQL (6432) + SSL
                v
┌─────────────────────────────────────┐
│  Yandex Managed PostgreSQL          │
└─────────────────────────────────────┘
```

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | No | User registration |
| POST | /api/auth/login | No | User login |
| POST | /api/auth/change-password | Yes | Change password |
| GET | /api/users/{id} | Yes | Get user info |
| POST | /api/messages | Yes | Send message |
| GET | /api/messages/{user_id} | Yes | Get message history |
| GET | /ws | Yes | WebSocket connection |

**URLs:**
- Web UI: `https://<your-domain>`
- API: `https://<your-domain>/api/`
- WebSocket: `wss://<your-domain>/ws`

## Deployment

### Prerequisites

1. **Yandex Cloud Account**: [cloud.yandex.ru](https://cloud.yandex.ru)
2. **YC_TOKEN**: OAuth token for Terraform
3. **Docker Hub Account**: For pushing images
4. **Domain**: A domain name pointed to Yandex Cloud

### Option 1: Min Deployment (Production)

```bash
cd terraform/envs/min

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars

# Deploy
terraform init
terraform apply
```

See [DEPLOY_MIN.md](DEPLOY_MIN.md) for full details.

### Option 2: Dev Deployment [dev]

Add `[dev]` to commit message to trigger Dev deployment:

```bash
git commit -m "your message [dev]"
```

See [DEPLOY.md](DEPLOY.md) for full details.

### CI/CD

Two separate workflows:
- **deploy-min.yml**: Default deployment (Min architecture)
- **deploy.yml**: Scalable deployment (triggered by `[dev]` tag in commit)

**Build & Deploy:**
- Builds Docker image with SHA tag
- Pushes to Docker Hub
- Deploys Terraform infrastructure
- Triggers rolling update on Instance Group
- Uses DB_HOST from database module output

**Required Secrets:**
- `DOCKERHUB_USERNAME` - your Docker Hub username
- `DOCKERHUB_TOKEN` - Docker Hub access token
- `YC_TOKEN` - Yandex Cloud OAuth token
- `YC_S3_ACCESS_KEY` / `YC_S3_SECRET_KEY` - S3 backend credentials
- `TF_STATE_BUCKET` - S3 bucket name for Terraform state
- `JWT_SECRET` - JWT signing secret
- `DB_PASSWORD` - PostgreSQL password
- `ENCRYPTION_KEY` - Message encryption key
- `DEFAULT_USER` / `DEFAULT_PASSWORD` - Default admin credentials (optional)

**Required Variables:**
- `YC_CLOUD_ID` - Yandex Cloud ID
- `YC_FOLDER_ID` - Yandex Folder ID
- `DOMAIN` - Domain name
- `JWT_DURATION` - Token lifetime (default: 24h)
- `DB_USER` - Database user (default: messenger)
- `DB_NAME` - Database name (default: messenger)
- `MIN_INSTANCES` / `MAX_INSTANCES` - Scaling (Dev only, default: 2/4)

## Environment Variables

### Application (Min)

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing secret | required |
| `JWT_DURATION` | Token lifetime | `24h` |
| `ENCRYPTION_KEY` | Message encryption key (min 32 chars) | required |
| `DB_USER` | Database user | required |
| `DB_PASSWORD` | Database password | required |
| `DB_NAME` | Database name | required |
| `DEFAULT_USER` | Default admin username | optional |
| `DEFAULT_PASSWORD` | Default admin password | optional |
| `ICE_SERVERS` | WebRTC ICE servers (JSON) | STUN only (no TURN) |

### ICE Servers Configuration

For WebRTC calls to work through NAT/VPN, configure TURN servers:

**Cloudflare Calls (Free, No Signup Required):**
```bash
# Add to .env
ICE_SERVERS=[{"urls":"stun:stun.cloudflare.com:3478"}]
```

**Custom TURN Server:**
```bash
# Example with coturn
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:your-turn-server.com:3478","username":"user","credential":"pass"}]
```

### Application (Dev - additional)

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | Managed PostgreSQL host | required |
| `DB_SSLMODE` | PostgreSQL SSL mode | `require` |

### Local Development Only

```bash
# For local development with docker-compose:
DB_HOST=localhost
DB_PORT=5432
```

## Getting YC_TOKEN

1. Go to [Yandex OAuth page](https://oauth.yandex.ru/authorize?response_type=token&client_id=1a6990aa636648e9b2ef855fa7bec454)
2. Login with your Yandex account
3. Copy the token from the URL or page

Alternative via CLI:
```bash
curl https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
yc iam create-token
```

## Key Features

### Backend
- **Stateless**: JWT tokens only, no sessions
- **Secure**: HTTPS, message encryption (AES-256-GCM), bcrypt passwords
- **Zero-downtime**: Rolling updates (Dev) or VM replacement (Min)
- **Auto SSL**: Caddy (Min) or Let's Encrypt (Dev)
- **Auto-migrations**: Database tables created automatically on startup

### Frontend
- **Custom Font**: Chicago font applied to all UI elements
- **Stable WebSocket**: Keep-alive with ping/pong (30s interval) and smart reconnection (exponential backoff)
- **Unread Notifications**: Tab title shows unread message count, updates in real-time
- **Push Notifications**: Browser notifications for new messages when tab is not active
- **WebRTC Calls**: Audio/Video calls with P2P connection (STUN/TURN via Cloudflare Calls)

## Cost

| Deployment | Infrastructure | Approx. Cost |
|------------|---------------|--------------|
| Min | 1 VM (2 cores, 2GB) | ~$5-10/month |
| Dev | ALB + 2 VMs + Managed DB | ~$65-90/month |

## License

MIT
