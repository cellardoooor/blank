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
| `TF_STATE_BUCKET` | Имя S3 bucket для state | Придумай любое уникальное имя (например: `terraform-state-messenger-xyz`) |
| `JWT_SECRET` | Секретный ключ для JWT токенов | `openssl rand -base64 32` |
| `DB_PASSWORD` | Пароль для PostgreSQL | Придумай сильный пароль (минимум 12 символов) |

#### GitHub Variables (открытые значения)

| Переменная | Зачем нужна | Где взять | Значение по умолчанию |
|------------|-------------|-----------|----------------------|
| `YC_CLOUD_ID` | ID облака Yandex | См. раздел [Получение Cloud/Folder ID](#получение-cloud_id-и-folder_id) | - |
| `YC_FOLDER_ID` | ID каталога Yandex | См. раздел [Получение Cloud/Folder ID](#получение-cloud_id-и-folder_id) | - |
| `HTTP_ADDR` | Порт приложения | Можно оставить по умолчанию | `:8080` |
| `JWT_DURATION` | Время жизни токена | Можно оставить по умолчанию | `24h` |
| `DB_HOST` | Хост базы данных | Можно оставить по умолчанию | `localhost` |
| `DB_PORT` | Порт PostgreSQL | Можно оставить по умолчанию | `5432` |
| `DB_USER` | Пользователь БД | Можно оставить по умолчанию | `messenger` |
| `DB_NAME` | Имя базы данных | Можно оставить по умолчанию | `messenger` |
| `DB_SSLMODE` | Режим SSL | Можно оставить по умолчанию | `disable` |

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

# Или посмотреть все папки
yc resource-manager folder list
```

### 3. Создание S3 ключей для Terraform State

Сначала нужен `YC_FOLDER_ID` (получить выше).

```bash
# 1. Создать Service Account для Terraform
yc iam service-account create --name terraform-sa

# 2. Получить ID сервисного аккаунта
SA_ID=$(yc iam service-account get terraform-sa --format=json | jq -r '.id')

# 3. Назначить роль storage.editor (нужен YC_FOLDER_ID)
yc resource-manager folder add-access-binding <YC_FOLDER_ID> \
  --role storage.editor \
  --subject serviceAccount:$SA_ID

# 4. Создать static access keys (сохрани вывод!)
yc iam access-key create --service-account-name terraform-sa
# Вывод будет:
# access_key:
#   id: ...
#   key_id: YCAJE... (это YC_S3_ACCESS_KEY)
# secret: YCPVG... (это YC_S3_SECRET_KEY)

# 5. Создать bucket для Terraform state (имя должно быть уникальным глобально!)
yc storage bucket create --name <UNIQUE_BUCKET_NAME>
# Например: terraform-state-messenger-$(date +%s)
```

**Что сохранить в GitHub Secrets:**
- `YC_S3_ACCESS_KEY` = key_id из вывода команды
- `YC_S3_SECRET_KEY` = secret из вывода команды
- `TF_STATE_BUCKET` = имя bucket'а которое придумал

### 4. Генерация секретов приложения

Для работы приложения нужны два секрета:

**1. JWT_SECRET** - ключ для подписи JWT токенов:
```bash
openssl rand -base64 32
```
Сохрани результат в GitHub Secret `JWT_SECRET`.

**2. DB_PASSWORD** - пароль для PostgreSQL:
Придумай сильный пароль (минимум 12 символов, буквы, цифры, спецсимволы) и сохрани в GitHub Secret `DB_PASSWORD`.

**Переменные по умолчанию** (можно не задавать, будут использованы значения из таблицы выше):
- `HTTP_ADDR=:8080`
- `JWT_DURATION=24h`
- `DB_HOST=localhost`
- `DB_PORT=5432`
- `DB_USER=messenger`
- `DB_NAME=messenger`
- `DB_SSLMODE=disable`

## Локальная разработка (опционально)

Если нужно запускать Terraform локально, а не через CI/CD:

```bash
cd terraform/envs/dev
cp terraform.tfvars.example terraform.tfvars

# Заполни terraform.tfvars:
# - yc_cloud_id, yc_folder_id (из раздела выше)
# - yc_token (из раздела 2)
# - docker_image (например: cellardooor/blank:latest)
# - jwt_secret, db_password (из раздела 4)
# - http_addr, jwt_duration, db_host, db_port, db_user, db_name, db_sslmode (опционально)
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
terraform apply
```

## CI/CD Pipeline

При push в `main`:

1. **Build job**:
   - Собирает Docker образ
   - Пушит в `cellardooor/blank:<tag>` и `cellardooor/blank:latest`

2. **Deploy job**:
   - Инициализирует Terraform с S3 backend
   - Передаёт переменные через `TF_VAR_*`:
     - Из **Secrets**: `yc_token`, `docker_image`, `app_env`
     - Из **Variables**: `yc_cloud_id`, `yc_folder_id`
   - Запускает `terraform plan`
   - При merge в `main`: `terraform apply -auto-approve`

### Ручной запуск деплоя

```bash
# Новая версия = новая VM (пересоздать)
terraform taint module.compute.yandex_compute_instance.main
terraform apply

# Или обновить образ на существующей VM
yc compute connect-to-serial-port $(yc compute instance list --format=json | jq -r '.[0].id')
sudo docker pull cellardooor/blank:latest
sudo systemctl restart messenger-app
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
├── Dockerfile            # Docker образ
├── docker-compose.yml    # Local development
├── terraform/            # Infrastructure
│   ├── network/          # VPC, subnet, security group
│   ├── compute/          # VM с cloud-init
│   └── envs/dev/         # Dev окружение
└── .github/workflows/    # CI/CD
    └── deploy.yml        # Build + Deploy pipeline
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

После деплоя получи IP адрес:
```bash
terraform output public_ip
```

- API: `http://<public_ip>:8080`
- Web UI: `http://<public_ip>:8080`
- WebSocket: `ws://<public_ip>:8080/ws`
