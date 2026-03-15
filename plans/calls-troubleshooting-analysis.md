# Calls Troubleshooting Analysis

## Проблема

**Симптом**: Звонок "соединяется" (UI показывает соединение, отсчёт времени), но аудио не передаётся. Ошибок в консоли нет.

**Диагноз**: WebRTC P2P соединение не устанавливается корректно. ICE candidates не находят путь между пирами.

---

## Анализ WebRTC соединения

### Как работает WebRTC P2P

```
┌─────────────┐                    ┌─────────────┐
│   Client A  │                    │   Client B  │
│  (Caller)   │                    │  (Callee)   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  1. SDP Offer ──────────────────►│
       │  (via WebSocket signalling)      │
       │                                  │
       │  2. SDP Answer ◄─────────────────│
       │  (via WebSocket signalling)      │
       │                                  │
       │  3. ICE Candidates ◄────────────►│
       │  (STUN/TURN discovery)           │
       │                                  │
       │  4. Direct P2P Connection        │
       │  (audio/video streams)           │
       └──────────────────────────────────┘
```

### ICE Connection States

| State | Описание |
|-------|----------|
| `new` | Начальное состояние |
| `checking` | Проверка ICE candidates |
| `connected` | Соединение установлено ✓ |
| `completed` | Все кандидаты проверены ✓ |
| `failed` | Не удалось соединиться ✗ |
| `disconnected` | Соединение потеряно |
| `closed` | Соединение закрыто |

**Важно**: UI может показывать "соединение", но если ICE state = `checking` или `failed`, аудио не будет.

---

## Возможные причины проблемы

### 1. NAT Traversal (самая вероятная)

**Проблема**: Оба клиента за NAT, STUN не может пробить NAT.

```
Client A (NAT) ←──?──→ STUN Server ←──?──→ Client B (NAT)
                    ↓
         STUN даёт публичный IP:port
                    ↓
         Но NAT блокирует входящие пакеты
```

**Решение**: TURN сервер для relay трафика.

### 2. ICE Candidates не обмениваются

**Проблема**: ICE candidates не доходят до пира через signalling.

**Проверка**:
- Логирование `onicecandidate` событий
- Проверка WebSocket сообщений `call_ice_candidate`

### 3. SDP не содержит audio track

**Проблема**: Offer/Answer не содержит audio m-line.

**Проверка**:
- Логирование SDP: `offer.sdp.includes('m=audio')`
- Проверка `getUserMedia()` успешности

### 4. Browser Permissions

**Проблема**: Микрофон не разрешён.

**Проверка**:
- `navigator.mediaDevices.getUserMedia()` возвращает ошибку?
- Browser показывает разрешение микрофона?

---

## Варианты решения

### Вариант A: Только STUN (текущий)

```javascript
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]
```

**Работает когда**:
- Оба клиента в одной локальной сети
- Один клиент имеет публичный IP
- NAT типа "full cone" или "port restricted"

**Не работает когда**:
- Оба клиента за symmetric NAT
- Оба клиента за corporate firewall
- Carrier-grade NAT (CGNAT)

**Успешность**: ~60-70% соединений

### Вариант B: STUN + Public TURN (рекомендуется)

```javascript
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { 
    urls: 'turn:turn.example.com:3478',
    username: 'user',
    credential: 'pass'
  }
]
```

**Работает**: 99% соединений (TURN relay как fallback)

**Публичные TURN серверы**:

| Сервис | Бесплатно | Ограничения |
|--------|-----------|-------------|
| Twilio STUN/TURN | Да (с аккаунтом) | Лимит трафика |
| Xirsys | Да (базовый) | 1GB/месяц |
| Metered.ca | Да (базовый) | Лимит соединений |
| Self-hosted coturn | Да | Нужен свой сервер |

### Вариант C: Self-hosted TURN (coturn)

**Плюсы**:
- Полный контроль
- Нет лимитов
- Можно на том же сервере что и приложение

**Минусы**:
- Нужен дополнительный сервер/порт
- Настройка безопасности

**Минимальные требования**:
- 1 CPU, 512MB RAM
- Публичный IP
- Открытые порты: 3478 (STUN/TURN), 5349 (TLS), 49152-65535 (relay)

---

## Рекомендуемое решение

### Фаза 1: Диагностика (сначала!)

Добавить детальное логирование ICE состояния:

```javascript
// В peer-connection.js
this.connection.oniceconnectionstatechange = () => {
  console.log('ICE connection state:', this.connection.iceConnectionState);
  console.log('ICE gathering state:', this.connection.iceGatheringState);
};

this.connection.onicecandidate = (event) => {
  if (event.candidate) {
    console.log('ICE candidate:', event.candidate.type, event.candidate.protocol);
  } else {
    console.log('ICE gathering complete');
  }
};
```

### Фаза 2: Добавить TURN сервер

**Быстрое решение**: Использовать бесплатный публичный TURN.

**Долгосрочное решение**: Развернуть свой coturn.

### Фаза 3: Улучшить UI feedback

Показывать реальное состояние соединения:
- "Подключение..." (ICE checking)
- "Соединено" (ICE connected)
- "Ошибка соединения" (ICE failed)

---

## План действий

### Шаг 1: Добавить диагностику
- [ ] Добавить логирование ICE states
- [ ] Добавить логирование SDP content
- [ ] Проверить обмен ICE candidates через WebSocket

### Шаг 2: Настроить TURN сервер
- [ ] Выбрать: публичный TURN или self-hosted
- [ ] Добавить TURN конфигурацию в ICE_SERVERS
- [ ] Протестировать соединение

### Шаг 3: Улучшить UX
- [ ] Показывать реальное состояние ICE
- [ ] Добавить индикатор "подключение/соединено"
- [ ] Обрабатывать ошибки соединения

---

## Сравнение вариантов TURN

### Публичные бесплатные TURN

| Провайдер | URL | Регистрация | Лимиты |
|-----------|-----|-------------|--------|
| Google STUN | stun:stun.l.google.com:19302 | Нет | Только STUN |
| Cloudflare STUN | stun:stun.cloudflare.com:3478 | Нет | Только STUN |
| Twilio | Через API | Да | Платное |
| Metered.ca | turn:openrelay.metered.ca:80 | Нет | 10GB/месяц |

### Self-hosted coturn

```bash
# Docker запуск
docker run -d \
  --name coturn \
  -p 3478:3478 \
  -p 3478:3478/udp \
  -p 5349:5349 \
  -p 5349:5349/udp \
  -p 49152-65535:49152-65535/udp \
  coturn/coturn \
  -n \
  --realm=messenger.local \
  --fingerprint \
  --lt-cred-mech \
  --user=messenger:secret123
```

**Конфигурация для клиента**:
```javascript
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { 
    urls: 'turn:your-server.com:3478',
    username: 'messenger',
    credential: 'secret123'
  }
]
```

---

## Вывод

**Нужен ли TURN сервер?** Да, для надёжной работы звонков между произвольными пользователями.

**Можно ли без него?** Только если:
- Пользователи в одной локальной сети
- Гарантированно открытые NAT
- Приемлем ~60-70% успешных соединений

**Рекомендация**: 
1. Сначала добавить диагностику ICE states
2. Использовать публичный TURN для тестирования
3. Для продакшена - развернуть свой coturn или использовать платный сервис
