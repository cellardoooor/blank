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

- `DOCKERHUB_USERNAME` - ваш username на Docker Hub (`cellardooor`)
- `DOCKERHUB_TOKEN` - Access Token из Docker Hub (Settings → Security)

Создать Docker Hub token:
```bash
# Docker Hub → Account Settings → Security → New Access Token
```

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

### 3. Настройка Terraform

```bash
cd terraform/envs/dev
cp terraform.tfvars.example terraform.tfvars

# Файл уже содержит:
# - yc_cloud_id = "b1gii3452auiela08s8k"
# - yc_folder_id = "b1gdnf54t05a11qn56sa"
# - docker_image = "cellardooor/blank:latest"
# 
# Нужно заполнить только:
# - yc_token (полученный выше)
# - JWT_SECRET и другие sensitive переменные
```

### 4. Деплой инфраструктуры

```bash
cd terraform/envs/dev
terraform init
terraform plan
terraform apply

# Вывод: public_ip адрес сервера
```

### 5. Деплой новой версии приложения

**Вариант 1: Новый образ → новая VM (рекомендуется)**

```bash
# После push в main (GitHub Actions соберёт и запушит образ)
terraform taint module.compute.yandex_compute_instance.main
terraform apply
```

**Вариант 2: Перезапуск на существующей VM (ручной)**

```bash
# Через Yandex Cloud Serial Console
yc compute connect-to-serial-port $(yc compute instance list --format=json | jq -r '.[0].id')

# На VM:
sudo docker pull cellardooor/blank:latest
sudo systemctl restart messenger-app
```

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

## Обновление приложения

При пуше в `main` или создании тега `v*`, GitHub Actions:
1. Собирает Docker образ
2. Пушит в `cellardooor/blank:<tag>`

Для обновления на сервере:

```bash
# Вариант A: Пересоздание VM (рекомендуется для immutable инфраструктуры)
terraform taint module.compute.yandex_compute_instance.main
terraform apply

# Вариант B: Pull нового образа на существующей VM
yc compute connect-to-serial-port <instance_id>
# На VM:
sudo docker pull cellardooor/blank:latest
sudo systemctl restart messenger-app
```

## Доступ к приложению

- API: `http://<public_ip>:8080`
- Web UI: `http://<public_ip>:8080`
- WebSocket: `ws://<public_ip>:8080/ws`

## Учетные данные Yandex Cloud (pre-filled)

```
cloud_id:  b1gii3452auiela08s8k
folder_id: b1gdnf54t05a11qn56sa
```
