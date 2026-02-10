# Messenger - Min Deploy

## Архитектура (Production)

**Минимальный деплой на одной VM**

```
Internet
    |
    | HTTPS (443)
    v
┌─────────────────────────────────────┐
│  Single VM (Ubuntu 22.04)           │
│  ┌─────────────────────────────┐    │
│  │ Caddy (reverse proxy + SSL) │    │
│  │ • Автоматический HTTPS      │    │
│  │ • Let's Encrypt сертификаты │    │
│  └──────────┬──────────────────┘    │
│             | HTTP (8080)           │
│             v                       │
│  ┌─────────────────────────────┐    │
│  │ App (Docker container)      │    │
│  │ • Go backend                │    │
│  │ • Порт 8080                 │    │
│  └──────────┬──────────────────┘    │
│             | PostgreSQL (5432)     │
│             v                       │
│  ┌─────────────────────────────┐    │
│  │ PostgreSQL (Docker)         │    │
│  │ • Версия 15                 │    │
│  │ • Данные на data disk       │    │
│  └─────────────────────────────┘    │
│                                     │
│  • Static IP (сохраняется)          │
│  • Data disk 20GB (персистентность) │
└─────────────────────────────────────┘
```

## Компоненты

| Компонент | Описание |
|-----------|----------|
| **VM** | Ubuntu 22.04, 2 vCPU, 2GB RAM |
| **Caddy** | Reverse proxy с автоматическим HTTPS |
| **App** | Go приложение в Docker контейнере |
| **PostgreSQL** | База данных в Docker контейнере |
| **Static IP** | Фиксированный IP адрес |
| **Data Disk** | 20GB HDD для данных PostgreSQL и Caddy |

## Подготовка

### 1. Настройка GitHub Secrets и Variables

В репозитории: **Settings → Secrets and variables → Actions**

#### GitHub Secrets

| Секрет | Описание |
|--------|----------|
| `DOCKERHUB_USERNAME` | Username для Docker Hub |
| `DOCKERHUB_TOKEN` | Токен для пуша образов |
| `YC_TOKEN` | OAuth токен для Terraform |
| `YC_S3_ACCESS_KEY` | Access key для S3 backend |
| `YC_S3_SECRET_KEY` | Secret key для S3 backend |
| `TF_STATE_BUCKET` | Имя S3 bucket для state |
| `JWT_SECRET` | Секретный ключ для JWT (`openssl rand -base64 32`) |
| `DB_PASSWORD` | Пароль для PostgreSQL |
| `ENCRYPTION_KEY` | Ключ шифрования сообщений (минимум 32 символа) |
| `DEFAULT_USER` | Логин админа по умолчанию |
| `DEFAULT_PASSWORD` | Пароль админа по умолчанию |

#### GitHub Variables

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `YC_CLOUD_ID` | ID облака Yandex | - |
| `YC_FOLDER_ID` | ID каталога Yandex | - |
| `DOMAIN` | Домен для HTTPS | - |
| `JWT_DURATION` | Время жизни токена | `24h` |
| `DB_USER` | Пользователь БД | `messenger` |
| `DB_NAME` | Имя базы данных | `messenger` |

### 2. Получение YC_TOKEN

```bash
# Через браузер
# Открыть: https://oauth.yandex.ru/authorize?response_type=token&client_id=1a6990aa636648e9b2ef855fa7bec454

# Через CLI
curl https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
yc iam create-token
```

### 3. Создание S3 ключей для Terraform State

```bash
# Создать Service Account
yc iam service-account create --name terraform-sa

# Получить ID
SA_ID=$(yc iam service-account get terraform-sa --format=json | jq -r '.id')

# Назначить роль
yc resource-manager folder add-access-binding <YC_FOLDER_ID> \
  --role storage.editor \
  --subject serviceAccount:$SA_ID

# Создать ключи
yc iam access-key create --service-account-name terraform-sa

# Создать bucket
yc storage bucket create --name <UNIQUE_BUCKET_NAME>
```

### 4. Настройка DNS

После деплоя получите статический IP:

```bash
terraform output vm_ip
```

Добавьте A-запись в DNS:
```
messenger.example.com.    A    <VM_IP>
```

## Деплой

### Автоматический (CI/CD)

Push в `main` ветку автоматически запускает деплой:

```bash
git add .
git commit -m "update message"
git push origin main
```

Workflow `deploy-min.yml`:
1. Собирает Docker образ с SHA тегом
2. Пушит образ в Docker Hub
3. Запускает Terraform apply
4. Выводит IP и домен

**Примечание**: Чтобы запустить Dev деплой вместо Min, добавьте `[dev]` в commit message:
```bash
git commit -m "update message [dev]"
```

### Ручной

```bash
cd terraform/envs/min

# Инициализация
terraform init \
  -backend-config="endpoints={s3=\"https://storage.yandexcloud.net\"}" \
  -backend-config="bucket=<TF_STATE_BUCKET>" \
  -backend-config="region=ru-central1" \
  -backend-config="key=min/terraform.tfstate" \
  -backend-config="access_key=<YC_S3_ACCESS_KEY>" \
  -backend-config="secret_key=<YC_S3_SECRET_KEY>" \
  -backend-config="skip_region_validation=true" \
  -backend-config="skip_credentials_validation=true" \
  -backend-config="skip_metadata_api_check=true" \
  -backend-config="skip_requesting_account_id=true"

# Копировать и настроить переменные
cp terraform.tfvars.example terraform.tfvars
# Редактировать terraform.tfvars

# Применить
terraform plan
terraform apply
```

## Структура проекта

```
terraform/
├── envs/
│   ├── min/                 # Min deployment (production)
│   │   ├── main.tf         # VPC + Subnet + VM + PostgreSQL + Caddy (no module)
│   │   ├── variables.tf    # Переменные
│   │   ├── outputs.tf      # Выходные значения
│   │   ├── backend.tf      # S3 backend
│   │   ├── providers.tf    # Провайдеры
│   │   ├── cloud_init_min.yaml  # Cloud-init конфигурация
│   │   └── terraform.tfvars.example
│   └── dev/                 # Dev deployment [dev] (uses network module)
└── network/                 # Network module (for Dev only: NAT, ALB, DB subnets)
```

## Переменные окружения приложения

| Variable | Description | Default |
|----------|-------------|---------|
| `HTTP_ADDR` | Server bind address | `:8080` |
| `JWT_SECRET` | JWT signing key | required |
| `JWT_DURATION` | Token lifetime | `24h` |
| `ENCRYPTION_KEY` | Message encryption key | required |
| `DB_HOST` | PostgreSQL host | `postgres` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USER` | Database user | required |
| `DB_PASSWORD` | Database password | required |
| `DB_NAME` | Database name | required |
| `DB_SSLMODE` | SSL mode | `disable` |
| `DEFAULT_USER` | Default admin | optional |
| `DEFAULT_PASSWORD` | Default password | optional |

## Доступ к приложению

После деплоя:

```bash
terraform output vm_ip
terraform output domain
```

- **Web UI**: `https://<domain>`
- **API**: `https://<domain>/api/`
- **WebSocket**: `wss://<domain>/ws`

## Мониторинг и отладка

### Подключение к VM

```bash
# SSH
ssh ubuntu@<vm_ip>

# Serial console
yc compute connect-to-serial-port <instance-id>
```

### Логи

```bash
# Все контейнеры
docker compose -f /opt/messenger/docker-compose.yml logs

# Приложение
docker logs messenger-app

# PostgreSQL
docker logs postgres

# Caddy (SSL)
docker logs caddy
```

### Перезапуск сервисов

```bash
cd /opt/messenger
docker compose restart app
docker compose restart caddy
docker compose restart postgres
```

## Troubleshooting

### SSL сертификат не получен

1. Проверьте DNS A-запись указывает на VM IP
2. Проверьте логи Caddy: `docker logs caddy`
3. Убедитесь, что порты 80 и 443 открыты

### Приложение не запускается

1. Проверьте логи: `docker logs messenger-app`
2. Проверьте переменные окружения: `cat /opt/messenger/docker-compose.yml`
3. Проверьте PostgreSQL: `docker logs postgres`

### Нет подключения к PostgreSQL

1. Проверьте, что PostgreSQL контейнер запущен: `docker ps`
2. Проверьте healthcheck: `docker inspect postgres | grep -A 10 Health`
3. Проверьте логи: `docker logs postgres`

### VM пересоздалась и потеряла данные

Data disk (`/dev/vdb`) персистентный и не удаляется при пересоздании VM. Данные PostgreSQL сохраняются на `/mnt/data/postgres`.

## Стоимость

| Ресурс | Конфигурация | Стоимость |
|--------|--------------|-----------|
| VM | standard-v3, 2 vCPU, 2GB RAM | ~$5/мес |
| Data Disk | 20GB HDD | ~$0.5/мес |
| Static IP | 1 адрес | ~$2/мес |
| **Итого** | | **~$7-8/мес** |

## Обновление

При push в main:
1. Новый Docker образ собирается
2. Terraform обнаруживает изменение образа
3. VM пересоздаётся с новым образом
4. Data disk подключается заново (данные сохраняются)
5. Caddy автоматически получает/обновляет SSL

**Время деплоя**: ~5-7 минут
