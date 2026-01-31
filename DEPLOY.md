# Messenger - Image-based Deploy

## Архитектура деплоя

**Вариант A: Image-based deploy (cloud-init pull)**

1. CI/CD собирает Docker образ и пушит в Docker Hub
2. Terraform создаёт новую VM
3. Cloud-init на VM:
   - Устанавливает Docker
   - Делает `docker pull cellardooor/blank:latest`
   - Запускает контейнер через systemd

## Подготовка

### 1. Настройка GitHub Secrets

В репозитории Settings → Secrets and variables → Actions:

**Docker Hub:**
- `DOCKERHUB_USERNAME` - ваш username на Docker Hub (`cellardooor`)
- `DOCKERHUB_TOKEN` - Access Token из Docker Hub (Settings → Security)

**Yandex Cloud:**
- `YC_TOKEN` - OAuth токен для Terraform
- `YC_S3_ACCESS_KEY` - Service Account access key для Object Storage
- `YC_S3_SECRET_KEY` - Service Account secret key для Object Storage
- `TF_STATE_BUCKET` - имя bucket для Terraform state (например: `terraform-state-messenger`)

### 2. Получение YC_TOKEN

Для Terraform нужен OAuth token Yandex Cloud:

**Способ 1: Через браузер**
1. Открыть: https://oauth.yandex.ru/authorize?response_type=token&client_id=1a6990aa636648e9b2ef855fa7bec454
2. Войти в аккаунт Яндекс
3. Скопировать токен из URL или страницы

**Способ 2: Через CLI**
```bash
# Установить Yandex CLI
curl https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
exec -l $SHELL

# Получить токен
yc iam create-token
```

### 3. Настройка S3 Backend для Terraform State

Создание Service Account и ключей для Object Storage:

```bash
# Создать service account
yc iam service-account create --name terraform-sa

# Назначить роли
yc resource-manager folder add-access-binding b1gdnf54t05a11qn56sa \
  --role storage.editor \
  --subject serviceAccount:$(yc iam service-account get terraform-sa --format=json | jq -r '.id')

# Создать static access keys
yc iam access-key create --service-account-name terraform-sa

# Создать bucket для state
yc storage bucket create --name terraform-state-messenger
```

### 4. Настройка Terraform

```bash
cd terraform/envs/dev
cp terraform.tfvars.example terraform.tfvars

# Заполнить:
# - yc_token (полученный выше)
# - JWT_SECRET и другие sensitive переменные в app_env
```

### 5. Локальный деплой

```bash
cd terraform/envs/dev

# Инициализация с backend (для локальной работы)
terraform init \
  -backend-config="endpoints={s3=\"https://storage.yandexcloud.net\"}" \
  -backend-config="bucket=terraform-state-messenger" \
  -backend-config="region=ru-central1" \
  -backend-config="key=dev/terraform.tfstate" \
  -backend-config="access_key=YOUR_ACCESS_KEY" \
  -backend-config="secret_key=YOUR_SECRET_KEY" \
  -backend-config="skip_region_validation=true" \
  -backend-config="skip_credentials_validation=true" \
  -backend-config="skip_requesting_account_id=true" \
  -backend-config="skip_metadata_api_check=true"

terraform plan
terraform apply
```

## CI/CD Pipeline

При push в `main`:

1. **Build job**:
   - Собирает Docker образ
   - Пушит в `cellardooor/blank:<tag>` и `cellardooor/blank:latest`

2. **Deploy job**:
   - Инициализирует Terraform с S3 backend через secrets
   - Запускает `terraform plan`
   - При merge в `main`: `terraform apply -auto-approve`

### Ручной запуск деплоя

```bash
# Новая версия = новая VM
terraform taint module.compute.yandex_compute_instance.main
terraform apply

# Или обновить образ на существующей VM
yc compute connect-to-serial-port $(yc compute instance list --format=json | jq -r '.[0].id')
sudo docker pull cellardooor/blank:latest
sudo systemctl restart messenger-app
```

## Terraform State

State хранится в **Yandex Object Storage (S3)**:
- **Bucket**: `terraform-state-messenger` (или твой из `TF_STATE_BUCKET`)
- **Key**: `dev/terraform.tfstate`
- **Credentials**: передаются через CI/CD secrets или при локальной инициализации

## Структура проекта

```
.
├── cmd/server/           # Go backend код
├── internal/             # Internal packages
├── web/                  # Frontend статика
├── Dockerfile            # Docker образ
├── docker-compose.yml    # Local development
├── terraform/            # Infrastructure
│   ├── network/          # VPC, subnet, security group
│   ├── compute/          # VM с cloud-init
│   └── envs/dev/         # Dev окружение
└── .github/workflows/    # CI/CD
    ├── deploy.yml        # Build + Deploy pipeline
```

## Переменные окружения приложения

| Variable | Description | Example |
|----------|-------------|---------|
| `HTTP_ADDR` | Server bind address | `:8080` |
| `JWT_SECRET` | JWT signing key | `change-in-production` |
| `JWT_DURATION` | Token lifetime | `24h` |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_USER` | Database user | `messenger` |
| `DB_PASSWORD` | Database password | `messenger` |
| `DB_NAME` | Database name | `messenger` |
| `DB_SSLMODE` | SSL mode | `disable` |

## Доступ к приложению

- API: `http://<public_ip>:8080`
- Web UI: `http://<public_ip>:8080`
- WebSocket: `ws://<public_ip>:8080/ws`

## Учетные данные Yandex Cloud

```
cloud_id:  b1gii3452auiela08s8k
folder_id: b1gdnf54t05a11qn56sa
```
