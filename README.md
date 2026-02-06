# Messenger Backend

Production-ready messenger backend on Go with PostgreSQL and WebSocket support.

## Features

- REST API + WebSocket (real-time messaging)
- JWT authentication
- 1-to-1 messaging (no group chats)
- Opaque message payloads (server doesn't interpret content)
- Stateless backend (ready for horizontal scaling)
- Docker support
- Terraform infrastructure for Yandex Cloud
- Custom Chicago font for all UI text
- **Scalable Architecture**: Load Balancer + Instance Group + Managed PostgreSQL

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
├── terraform/           # Infrastructure as Code (ALB, Instance Group, Managed PostgreSQL)
└── migrations/          # Database migrations
```

## Architecture

```
Internet
    |
    | HTTPS (443)
    v
┌─────────────────────────────────────┐
│  Yandex Application Load Balancer   │
│  • TLS Termination (Let's Encrypt)  │
│  • HTTP → HTTPS redirect            │
│  • Health checks                    │
│  • Auto-renewal (90 days)           │
└──────────────┬──────────────────────┘
               | HTTP (8080)
               v
┌─────────────────────────────────────┐
│  Yandex Compute Instance Group      │
│  • Min: 2 VMs                       │
│  • Auto-healing                     │
│  • Rolling updates                  │
└──────────────┬──────────────────────┘
               | PostgreSQL (6432) + SSL
               v
┌─────────────────────────────────────┐
│  Yandex Managed PostgreSQL          │
│  • Version 15                       │
│  • Private subnet                   │
│  • Automatic backups                │
└─────────────────────────────────────┘
```

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | No | User registration |
| POST | /api/auth/login | No | User login |
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
4. **Domain**: A domain name pointed to Yandex Cloud (for HTTPS)

### Infrastructure Setup

```bash
cd terraform/envs/dev

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your YC_TOKEN and DOMAIN

# Deploy infrastructure
terraform init
terraform plan
terraform apply

# Get ALB IP and DNS challenge records
terraform output alb_ip_address
terraform output dns_challenge_records

# Add DNS records (see DEPLOY.md for details)
# 1. A-record for your domain → ALB IP
# 2. CNAME for Let's Encrypt validation

# Check certificate status
terraform output certificate_status
# Wait for ISSUED status, then access https://<your-domain>
```

### CI/CD

GitHub Actions automatically builds and pushes Docker image on push to `main`.

**Required Secrets:**
- `DOCKERHUB_USERNAME` - your Docker Hub username
- `DOCKERHUB_TOKEN` - Docker Hub access token
- `YC_TOKEN` - Yandex Cloud OAuth token
- `YC_S3_ACCESS_KEY` / `YC_S3_SECRET_KEY` - S3 backend credentials
- `TF_STATE_BUCKET` - S3 bucket name for Terraform state
- `JWT_SECRET` - JWT signing secret (generate with `openssl rand -base64 32`)
- `DB_PASSWORD` - Managed PostgreSQL password
- `YC_SERVICE_ACCOUNT_ID` - Service account for Instance Group (optional)

**Required Variables:**
- `YC_CLOUD_ID` - Yandex Cloud ID
- `YC_FOLDER_ID` - Yandex Folder ID
- `DOMAIN` - Domain name (e.g., messenger.example.com)
- `DB_USER` - Database user
- `DB_NAME` - Database name
- `MIN_INSTANCES` - Minimum VM count (default: 2)
- `MAX_INSTANCES` - Maximum VM count (default: 4)

## Environment Variables

### Application

| Variable | Description | Default |
|----------|-------------|---------|
| `HTTP_ADDR` | Server bind address | `:8080` |
| `JWT_SECRET` | JWT signing secret | required |
| `JWT_DURATION` | Token lifetime | `24h` |
| `DB_HOST` | Managed PostgreSQL host | required |
| `DB_PORT` | PostgreSQL port | `6432` |
| `DB_USER` | Database user | required |
| `DB_PASSWORD` | Database password | required |
| `DB_NAME` | Database name | required |
| `DB_SSLMODE` | SSL mode | `require` |

### Local Development Only

```bash
# For local development with docker-compose:
DB_HOST=localhost
DB_PORT=5432
DB_SSLMODE=disable
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

- **Stateless**: JWT tokens only, no sessions
- **Highly Available**: Min 2 VMs with auto-healing
- **Scalable**: Instance Group with auto-scaling support
- **Secure**: HTTPS with Let's Encrypt, SSL for database, restrictive security groups
- **Zero-downtime**: Rolling updates via Instance Group
- **Auto SSL**: Let's Encrypt certificates with automatic renewal (90 days)
- **Frontend**: Custom Chicago font applied to all UI elements

## License

MIT
