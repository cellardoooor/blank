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

## Quick Start

### Local Development

```bash
# Clone repository
git clone <repo-url>
cd messenger

# Start dependencies
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
├── web/                 # Frontend static files
├── terraform/           # Infrastructure as Code
└── migrations/          # Database migrations
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

## Deployment

### Prerequisites

1. **Yandex Cloud Account**: [cloud.yandex.ru](https://cloud.yandex.ru)
2. **YC_TOKEN**: OAuth token for Terraform (see [Getting YC_TOKEN](#getting-yctoken))
3. **Docker Hub Account**: For pushing images

### Infrastructure Setup

```bash
cd terraform/envs/dev

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your YC_TOKEN

# Deploy infrastructure
terraform init
terraform plan
terraform apply

# Output will show public_ip
```

### CI/CD

GitHub Actions automatically builds and pushes Docker image on push to `main`.

Required secrets:
- `DOCKERHUB_USERNAME` - your Docker Hub username
- `DOCKERHUB_TOKEN` - Docker Hub access token

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HTTP_ADDR` | Server bind address | `:8080` |
| `JWT_SECRET` | JWT signing secret | required |
| `JWT_DURATION` | Token lifetime | `24h` |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_USER` | Database user | `messenger` |
| `DB_PASSWORD` | Database password | `messenger` |
| `DB_NAME` | Database name | `messenger` |
| `DB_SSLMODE` | SSL mode | `disable` |

## Getting YC_TOKEN

1. Go to [Yandex OAuth page](https://oauth.yandex.ru/authorize?response_type=token&client_id=1a6990aa636648e9b2ef855fa7bec454)
2. Login with your Yandex account
3. Copy the token from the URL or page
4. Use it in `terraform.tfvars`:
   ```hcl
   yc_token = "y0_AgAAAAAA..."
   ```

Alternative via CLI:
```bash
# Install Yandex CLI
curl https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash

# Get OAuth token
yc iam create-token
```

## Architecture

- **Stateless**: No server-side sessions, JWT tokens only
- **Horizontal scaling ready**: Can run multiple instances behind LB
- **Image-based deploy**: New version = new VM with pulled image
- **No managed services**: Self-contained on single VM

## License

MIT
