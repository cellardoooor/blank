# Messenger - Scalable Deploy

## Архитектура деплоя (Production-Ready)

**Масштабируемая архитектура с Load Balancer**

```
Internet
    |
    | HTTPS (443)
    v
┌─────────────────────────────────────┐
│  Yandex Application Load Balancer   │
│  • TLS Termination (Let's Encrypt)  │
│  • HTTP → HTTPS redirect            │
│  • Health checks: /api/health       │
└──────────────┬──────────────────────┘
               | HTTP (8080)
               v
┌─────────────────────────────────────┐
│  Yandex Compute Instance Group      │
│  • Минимум 2 VM (High Availability) │
│  • Container-Optimized OS           │
│  • Auto-healing                     │
│  • Rolling updates (zero-downtime)  │
└──────────────┬──────────────────────┘
               | PostgreSQL (6432) + SSL
               v
┌─────────────────────────────────────┐
│  Yandex Managed PostgreSQL          │
│  • Версия 15                        │
│  • Приватная подсеть                │
│  • Только SSL-соединения            │
│  • Автоматические бэкапы            │
└─────────────────────────────────────┘
```

## Сетевая сегментация

- **Public subnet (10.0.1.0/24)**: Application Load Balancer
- **App subnet (10.0.2.0/24)**: Instance Group (VM с приложением)
- **DB subnet (10.0.3.0/24)**: Managed PostgreSQL

**Security Groups:**
- PostgreSQL доступен только из App subnet (порт 6432)
- Приложение доступно только из ALB (порт 8080)
- ALB доступен из интернета (порты 80, 443)

## Подготовка

### 1. Настройка GitHub Secrets и Variables

В репозитории: **Settings → Secrets and variables → Actions**

#### GitHub Secrets (защищённые значения)

| Секрет | Зачем нужен | Где взять |
|--------|-------------|-----------|
| `DOCKERHUB_USERNAME` | Username для Docker Hub | Docker Hub → Account Settings |
| `DOCKERHUB_TOKEN` | Токен для пуша образов | Docker Hub → Account Settings → Security → New Access Token |
| `YC_TOKEN` | OAuth токен для Terraform | См. раздел [Получение YC_TOKEN](#2-получение-yctoken) |
| `YC_S3_ACCESS_KEY` | Access key для S3 backend | См. раздел [Создание S3 ключей](#3-создание-s3-ключей-для-terraform-state) |
| `YC_S3_SECRET_KEY` | Secret key для S3 backend | См. раздел [Создание S3 ключей](#3-создание-s3-ключей-для-terraform-state) |
| `TF_STATE_BUCKET` | Имя S3 bucket для state | Придумай уникальное имя |
| `JWT_SECRET` | Секретный ключ для JWT токенов | `openssl rand -base64 32` |
| `DB_PASSWORD` | Пароль для Managed PostgreSQL | Придумай сильный пароль (минимум 12 символов) |
| `YC_SERVICE_ACCOUNT_ID` | ID сервисного аккаунта для Instance Group | См. раздел [Сервисный аккаунт](#сервисный-аккаунт-для-instance-group) |

#### GitHub Variables (открытые значения)

| Переменная | Зачем нужна | Где взять | Значение по умолчанию |
|------------|-------------|-----------|----------------------|
| `YC_CLOUD_ID` | ID облака Yandex | См. раздел [Получение Cloud/Folder ID](#получение-cloud_id-и-folder_id) | - |
| `YC_FOLDER_ID` | ID каталога Yandex | См. раздел [Получение Cloud/Folder ID](#получение-cloud_id-и-folder_id) | - |
| `DOMAIN` | Домен для HTTPS | Например: messenger.example.com | - |
| `HTTP_ADDR` | Порт приложения | Можно оставить `:8080` | `:8080` |
| `JWT_DURATION` | Время жизни токена | Можно оставить `24h` | `24h` |
| `DB_USER` | Пользователь БД | Например: messenger | messenger |
| `DB_NAME` | Имя базы данных | Например: messenger | messenger |
| `MIN_INSTANCES` | Минимальное количество VM | Для отказоустойчивости | 2 |
| `MAX_INSTANCES` | Максимальное количество VM | Для масштабирования | 4 |

### 2. Получение YC_TOKEN

OAuth токен для доступа Terraform к Yandex Cloud:

**Способ 1: Через браузер (быстрее)**
1. Открыть: https://oauth.yandex.ru/authorize?response_type=token&client_id=1a6990aa636648e9b2ef855fa7bec454
2. Войти в аккаунт Яндекс
3. Скопировать токен из URL (`access_token=...`) или страницы

**Способ 2: Через CLI**
```bash
# Установить Yandex CLI
curl https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
exec -l $SHELL

# Получить токен
yc iam create-token
```

### Получение CLOUD_ID и FOLDER_ID

**Через Yandex Cloud Console:**
1. Открыть https://console.cloud.yandex.ru
2. Вверху страницы видно имя каталога - кликнуть на него
3. В выпадающем меню будет ID каталога (это `YC_FOLDER_ID`)
4. ID облака (`YC_CLOUD_ID`) можно найти в настройках облака (шестерёнка рядом с именем)

**Через CLI:**
```bash
# Получить Cloud ID
yc config list | grep cloud-id

# Получить Folder ID
yc config list | grep folder-id
```

### 3. Создание S3 ключей для Terraform State

```bash
# 1. Создать Service Account для Terraform
yc iam service-account create --name terraform-sa

# 2. Получить ID сервисного аккаунта
SA_ID=$(yc iam service-account get terraform-sa --format=json | jq -r '.id')

# 3. Назначить роль storage.editor
yc resource-manager folder add-access-binding <YC_FOLDER_ID> \
  --role storage.editor \
  --subject serviceAccount:$SA_ID

# 4. Создать static access keys
yc iam access-key create --service-account-name terraform-sa
# Сохрани: key_id (YC_S3_ACCESS_KEY) и secret (YC_S3_SECRET_KEY)

# 5. Создать bucket для Terraform state
yc storage bucket create --name <UNIQUE_BUCKET_NAME>
```

### Сервисный аккаунт для Instance Group

Instance Group нуждается в сервисном аккаунте для управления VM:

```bash
# 1. Создать Service Account для Instance Group
yc iam service-account create --name ig-sa

# 2. Получить ID
SA_ID=$(yc iam service-account get ig-sa --format=json | jq -r '.id')

# 3. Назначить роли
yc resource-manager folder add-access-binding <YC_FOLDER_ID> \
  --role compute.editor \
  --subject serviceAccount:$SA_ID

yc resource-manager folder add-access-binding <YC_FOLDER_ID> \
  --role load-balancer.editor \
  --subject serviceAccount:$SA_ID

# 4. Сохранить ID в GitHub Secrets как YC_SERVICE_ACCOUNT_ID
echo $SA_ID
```

### 4. Настройка домена

1. Зарегистрируй домен (например, messenger.example.com)
2. В DNS настрой A-запись:
   ```
   messenger.example.com.  A  <ALB_IP>
   ```
3. ALB IP будет получен после первого деплоя
4. Let's Encrypt автоматически выпустит сертификат

## Локальная разработка

```bash
cd terraform/envs/dev
cp terraform.tfvars.example terraform.tfvars

# Заполни terraform.tfvars:
# - yc_cloud_id, yc_folder_id
# - yc_token
# - domain
# - docker_image
# - jwt_secret, db_password
```

**CI/CD не использует terraform.tfvars** — все значения берутся из GitHub Secrets/Variables.

### Локальный деплой с S3 backend

```bash
cd terraform/envs/dev

# Инициализация с backend
terraform init \
  -backend-config="endpoints={s3=\"https://storage.yandexcloud.net\"}" \
  -backend-config="bucket=<TF_STATE_BUCKET>" \
  -backend-config="region=ru-central1" \
  -backend-config="key=dev/terraform.tfstate" \
  -backend-config="access_key=<YC_S3_ACCESS_KEY>" \
  -backend-config="secret_key=<YC_S3_SECRET_KEY>" \
  -backend-config="skip_region_validation=true" \
  -backend-config="skip_credentials_validation=true" \
  -backend-config="skip_metadata_api_check=true" \
  -backend-config="skip_requesting_account_id=true"

terraform plan

# Деплой (rolling update, не пересоздаёт инфраструктуру)
terraform apply
```

## CI/CD Pipeline

При push в `main`:

1. **Changes job**:
   - Анализирует изменённые файлы
   - Определяет, нужен ли build и deploy
   
2. **Build job**:
   - Собирает Docker образ если изменился код
   - Пушит в Docker Hub

3. **Deploy job**:
   - Инициализирует Terraform с S3 backend
   - Выполняет rolling update через Instance Group
   - **Zero-downtime**: новые VM создаются, старые удаляются после health check
   - Выводит домен и количество инстансов

### Как работает rolling update

```
1. Terraform видит новый Docker образ
2. Instance Group создаёт новую VM с новым образом
3. Новая VM проходит health check
4. ALB начинает слать трафик на новую VM
5. Старая VM удаляется
6. Повторяется для всех VM в группе
```

## Terraform State

State хранится в **Yandex Object Storage (S3)**:
- **Bucket**: имя из `TF_STATE_BUCKET`
- **Key**: `dev/terraform.tfstate`
- **Credentials**: `YC_S3_ACCESS_KEY` и `YC_S3_SECRET_KEY`

## Структура проекта

```
.
├── cmd/server/           # Go backend код
├── internal/             # Internal packages
├── web/                  # Frontend статика
├── Dockerfile            # Docker образ (только приложение, без PostgreSQL)
├── docker-compose.yml    # Local development (с локальным PostgreSQL)
├── terraform/            # Infrastructure
│   ├── alb/             # Application Load Balancer
│   ├── compute/         # Instance Group
│   ├── database/        # Managed PostgreSQL
│   ├── network/         # VPC, subnets, security groups
│   └── envs/dev/        # Dev окружение
└── .github/workflows/    # CI/CD
    └── deploy.yml        # Build + Deploy pipeline
```

## Переменные окружения приложения

| Variable | Description | Example |
|----------|-------------|---------|
| `HTTP_ADDR` | Server bind address | `:8080` |
| `JWT_SECRET` | JWT signing key | `<base64-string>` |
| `JWT_DURATION` | Token lifetime | `24h` |
| `DB_HOST` | Managed PostgreSQL host | `rc1a-...mdb.yandexcloud.net` |
| `DB_PORT` | PostgreSQL port | `6432` |
| `DB_USER` | Database user | `messenger` |
| `DB_PASSWORD` | Database password | `<password>` |
| `DB_NAME` | Database name | `messenger` |
| `DB_SSLMODE` | SSL mode | `require` |

## Доступ к приложению

После деплоя:

```bash
# Получить ALB IP
terraform output alb_ip_address

# Получить домен
terraform output domain
```

- **Web UI**: `https://<domain>`
- **API**: `https://<domain>/api/`
- **WebSocket**: `wss://<domain>/ws`

## Мониторинг и отладка

### Проверить статус Instance Group

```bash
yc compute instance-group list
yc compute instance-group get <group-id>
```

### Проверить ALB

```bash
yc alb load-balancer list
yc alb backend-group list
```

### Логи приложения

```bash
# Подключиться к VM по serial console
yc compute connect-to-serial-port <instance-id>

# Посмотреть логи контейнера
sudo docker logs messenger-app
```

### Проверить подключение к PostgreSQL

```bash
# С одной из VM
psql "host=<db_host> port=6432 user=<user> dbname=<db> sslmode=require"
```

## Troubleshooting

### ALB показывает unhealthy backends

1. Проверить health endpoint: `curl http://<vm-ip>:8080/api/health`
2. Проверить security groups (App SG должен разрешать 8080 от ALB)
3. Проверить логи приложения

### Не работает WebSocket

1. Убедиться, что используется `wss://` (не `ws://`)
2. Проверить, что JWT токен валидный
3. ALB поддерживает WebSocket по умолчанию

### Нет подключения к PostgreSQL

1. Проверить `DB_HOST` (должен быть FQDN Managed PostgreSQL)
2. Проверить `DB_SSLMODE=require`
3. Проверить Security Group (DB SG разрешает 6432 только из App subnet)
4. Проверить, что Managed PostgreSQL создан и запущен

## Масштабирование

### Увеличить количество инстансов

Изменить в GitHub Variables:
- `MIN_INSTANCES=4`
- `MAX_INSTANCES=8`

Следующий деплой применит изменения.

### Включить auto-scaling

В `terraform/compute/instance_group.tf` изменить `scale_policy`:

```hcl
scale_policy {
  auto_scale {
    min_zone_size = 2
    max_size      = var.max_instances
    measurement_duration = 60
    cpu_utilization_target = 75
    warmup_duration = 120
  }
}
```

## Безопасность

- **Network Segmentation**: 3 подсети с разным уровнем доступа
- **Least Privilege**: Security Groups разрешают только необходимые порты
- **SSL/TLS**: HTTPS для клиентов, SSL для PostgreSQL
- **No Public Access**: VM и PostgreSQL недоступны из интернета напрямую
- **Secrets**: Все credentials в GitHub Secrets

## Стоимость (примерная)

- **ALB**: ~$20-30/мес
- **2x VM (s2.micro)**: ~$15-20/мес
- **Managed PostgreSQL (s2.micro)**: ~$30-40/мес
- **Итого**: ~$65-90/мес

Для тестирования можно использовать меньшие инстансы.
