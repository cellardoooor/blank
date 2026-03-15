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
│  • NAT Gateway (Internet access)    │
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
- **App subnet (10.0.2.0/24)**: Instance Group (VM с приложением) + NAT Gateway
- **DB subnet (10.0.3.0/24)**: Managed PostgreSQL

**Security Groups:**
- PostgreSQL доступен только из App subnet (порт 6432)
- Приложение доступно только из ALB (порт 8080)
- ALB доступен из интернета (порты 80, 443)
- NAT Gateway позволяет VM выходить в интернет (Docker pull, обновления)

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
| `ENCRYPTION_KEY` | Ключ для шифрования сообщений | `openssl rand -base64 32` (минимум 32 символа) |
| `YC_SERVICE_ACCOUNT_ID` | ID сервисного аккаунта для Instance Group | См. раздел [Сервисный аккаунт](#сервисный-аккаунт-для-instance-group) |
| `DEFAULT_USER` | Логин админа по умолчанию | Например: `admin` |
| `DEFAULT_PASSWORD` | Пароль админа по умолчанию | Например: `admin123` |

⚠️ **Важно**: `ENCRYPTION_KEY` должен быть:
- Минимум 32 символа (будет дополнен/обрезан до 32 байт)
- Одинаковым на всех инстансах приложения
- **Никогда не теряться** - потеря ключа = потеря доступа ко всем сообщениям!

#### GitHub Variables (открытые значения)

| Переменная | Зачем нужна | Где взять | Значение по умолчанию |
|------------|-------------|-----------|----------------------|
| `YC_CLOUD_ID` | ID облака Yandex | См. раздел [Получение Cloud/Folder ID](#получение-cloud_id-и-folder_id) | - |
| `YC_FOLDER_ID` | ID каталога Yandex | См. раздел [Получение Cloud/Folder ID](#получение-cloud_id-и-folder_id) | - |
| `DOMAIN` | Домен для HTTPS | Например: messenger.example.com | - |
| `JWT_DURATION` | Время жизни токена | Можно оставить `24h` | `24h` |
| `DB_USER` | Пользователь БД | Например: messenger | messenger |
| `DB_NAME` | Имя базы данных | Например: messenger | messenger |
| `MIN_INSTANCES` | Минимальное количество VM | Для отказоустойчивости | 2 |
| `MAX_INSTANCES` | Максимальное количество VM | Для масштабирования | 4 |
| `ICE_SERVERS` | ICE серверы для WebRTC звонков | JSON массив STUN/TURN серверов | OpenRelay (бесплатный TURN) |

#### ICE_SERVERS для WebRTC звонков

**ICE_SERVERS** - JSON массив STUN/TURN серверов для WebRTC звонков. TURN сервер обязателен для работы звонков между пользователями за NAT (symmetric NAT, corporate firewall, CGNAT).

**По умолчанию** используется бесплатный публичный TURN сервер OpenRelay (10GB/месяц бесплатно):
```json
[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:openrelay.metered.ca:80","username":"openrelayproject","credential":"openrelayproject"},{"urls":"turn:openrelay.metered.ca:443","username":"openrelayproject","credential":"openrelayproject"},{"urls":"turn:openrelay.metered.ca:443?transport=tcp","username":"openrelayproject","credential":"openrelayproject"}]
```

**Альтернативы:**
- **Self-hosted coturn** - свой TURN сервер (рекомендуется для продакшена, полный контроль)
- **Twilio/Xirsys** - платные сервисы с высокой надёжностью
- **Только STUN** - работает только для ~60-70% соединений (не рекомендуется)

#### Безопасность

- **Все пароли и ключи** хранятся в GitHub Secrets
- **ENCRYPTION_KEY** должен быть одинаковым на всех инстансах
- **Сохрани ENCRYPTION_KEY** в надёжном месте (парольный менеджер)
- Потеря `ENCRYPTION_KEY` = потеря всех сообщений навсегда

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

### 4. Настройка домена и SSL-сертификата

#### 4.1 Регистрация домена

1. Зарегистрируй домен (например, messenger.example.com)
2. Убедись, что у тебя есть доступ к DNS-записям домена

#### 4.2 Первый деплой (без SSL)

1. Запусти `terraform apply` - инфраструктура создастся
2. Получи ALB IP адрес:
   ```bash
   terraform output alb_ip_address
   ```

#### 4.3 Настройка DNS

**Обязательные DNS-записи:**

```
; Основная A-запись
messenger.example.com.    A    <ALB_IP>

; CNAME для www
www.messenger.example.com.    CNAME    messenger.example.com.
```

**Записи для Let's Encrypt (выпускаются автоматически):**

После первого деплоя Terraform выведет DNS-записи для подтверждения домена:

```bash
terraform output dns_challenge_records
```

Пример вывода:
```
[
  {
    "domain" = "messenger.example.com"
    "type" = "CNAME"
    "name" = "_acme-challenge.messenger.example.com"
    "value" = "abc123.challenges.cm.yandexcloud.net"
  }
]
```

**Добавь эту CNAME-запись в DNS:**
```
_acme-challenge.messenger.example.com.    CNAME    abc123.challenges.cm.yandexcloud.net
```

#### 4.4 Подтверждение сертификата

1. Добавь CNAME-запись в DNS (как показано выше)
2. Подожди 5-15 минут для распространения DNS
3. Проверь статус сертификата:
   ```bash
   terraform output certificate_status
   ```
   - `PENDING_VALIDATION` - ждём подтверждения DNS
   - `VALIDATING` - проверяем DNS-запись
   - `ISSUED` - сертификат готов! ✅

4. Если статус `ISSUED`, сайт доступен по HTTPS:
   ```
   https://messenger.example.com
   ```

**Примечание:** Let's Encrypt сертификат автоматически обновляется каждые 90 дней.

## Database Migrations

**Важно**: Миграции базы данных запускаются **автоматически** при старте приложения.

- **Локация**: `internal/storage/postgres/migration.go`
- **Когда запускаются**: При каждом подключении к БД
- **Что создаёт**:
  - Таблица `users` с индексами
  - Таблица `messages` с индексами
  - Расширение `pgcrypto` для UUID
- **Ручной запуск не требуется** - просто деплой приложения

## Message Encryption

Все сообщения шифруются перед сохранением в базу данных:

- **Алгоритм**: AES-256-GCM
- **Ключ**: `ENCRYPTION_KEY` из GitHub Secrets
- **Хранение**: Шифрованные данные в колонке `messages.payload`
- **Требования**:
  - Ключ должен быть одинаковым на всех VM
  - Минимум 32 символа
  - **Никогда не терять ключ** - сообщения станут недоступны

## Локальная разработка

```bash
# Клонирование
git clone <repo-url>
cd messenger

# Настройка переменных окружения
cp .env.example .env
# Отредактируй .env:
# - DB_HOST=localhost
# - ENCRYPTION_KEY=your-key-min-32-chars
# - JWT_SECRET=your-secret

# Запуск локальной БД
docker-compose up -d postgres

# Запуск приложения
go run cmd/server/main.go
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

Используется единый workflow для сборки и деплоя:

### Workflow: Build and Deploy (`.github/workflows/deploy.yml`)

**Запускается при:**
- Push в `main` ветку
- Вручную (`workflow_dispatch`)

**Что делает:**

#### Job 1: Build
1. Checkout кода
2. Setup Docker Buildx
3. Логин в Docker Hub
4. Генерация SHA тега (формат: `sha-xxxxxxx`)
5. Сборка и пуш Docker образа

#### Job 2: Deploy (зависит от Build)
1. Checkout кода
2. Setup Terraform
3. Terraform Init с S3 backend
4. Terraform Apply:
   - Создаёт/обновляет всю инфраструктуру
   - Managed PostgreSQL (если не создан)
   - Instance Group с новым Docker образом
   - Application Load Balancer
   - Security Groups и Network
   - **Rolling update** происходит автоматически
5. Вывод summary с URL и статусом

**Передаваемые переменные в Terraform:**
- Все Secrets: `JWT_SECRET`, `DB_PASSWORD`, `ENCRYPTION_KEY`, etc.
- Все Variables: `DOMAIN`, `DB_USER`, etc.
- Docker образ: `TF_VAR_docker_image=<sha-tag>`

**Особенности:**
- Единый workflow (не нужно запускать инфраструктуру отдельно)
- Compute модуль ждёт создания Database (`depends_on`)
- Docker образ использует SHA тег из Build stage
- Rolling update происходит автоматически через Instance Group
- Database migrations запускаются автоматически при старте приложения

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
│   ├── network/         # VPC, subnets, security groups, NAT Gateway
│   └── envs/dev/        # Dev окружение
└── .github/workflows/    # CI/CD
    └── deploy.yml        # Build & Deploy workflow
```

## Переменные окружения приложения

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `JWT_SECRET` | JWT signing key | `<base64-string>` | Yes |
| `JWT_DURATION` | Token lifetime | `24h` | No |
| `ENCRYPTION_KEY` | Message encryption key (min 32 chars) | `<32+ chars>` | Yes |
| `DB_HOST` | Managed PostgreSQL host | `rc1a-...mdb.yandexcloud.net` | Yes |
| `DB_USER` | Database user | `messenger` | Yes |
| `DB_PASSWORD` | Database password | `<password>` | Yes |
| `DB_NAME` | Database name | `messenger` | Yes |
| `DB_SSLMODE` | PostgreSQL SSL mode | `require` | No |
| `DEFAULT_USER` | Default admin username | `admin` | No |
| `DEFAULT_PASSWORD` | Default admin password | `admin123` | No |

**Важно**: `ENCRYPTION_KEY` должен быть одинаковым на всех инстансах приложения!

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

### Ошибка шифрования сообщений

1. Проверить, что `ENCRYPTION_KEY` установлен в GitHub Secrets
2. Убедиться, что ключ минимум 32 символа
3. Проверить, что ключ одинаковый на всех VM
4. Проверить логи приложения: `docker logs messenger-app`

### Сообщения не отображаются (после смены ключа)

⚠️ **Если `ENCRYPTION_KEY` изменился или потерян**:
- Старые сообщения нельзя расшифровать
- Новые сообщения будут работать
- **Восстановление невозможно** без старого ключа

### Таблицы не создались автоматически

1. Проверить подключение к БД в логах
2. Убедиться, что приложение стартовало после подключения к БД
3. Проверить логи миграций: `docker logs messenger-app | grep -i migration`

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
- **Message Encryption**: AES-256-GCM для всех сообщений в БД
- **Password Hashing**: bcrypt для паролей пользователей
- **No Public Access**: VM и PostgreSQL недоступны из интернета напрямую
- **Secrets**: Все credentials в GitHub Secrets
- **Key Management**: ENCRYPTION_KEY единый для всех инстансов

## Стоимость (примерная)

- **ALB**: ~$20-30/мес
- **2x VM (s2.micro)**: ~$15-20/мес
- **Managed PostgreSQL (s2.micro)**: ~$30-40/мес
- **Итого**: ~$65-90/мес

Для тестирования можно использовать меньшие инстансы.
