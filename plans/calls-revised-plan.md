# Calls Implementation - Revised Plan

## Обновление от 2026-03-15

**Проблема**: Звонки "соединяются" в UI, но аудио не передаётся. ICE соединение не устанавливается.

**Решение**: Добавить TURN сервер + улучшить диагностику.

---

## Краткий ответ на вопросы

### Нужны ли сторонние публичные серверы?

**Да, TURN сервер нужен** для надёжной работы звонков между произвольными пользователями в интернете.

**Почему**:
- STUN серверы (Google, Cloudflare) бесплатны и работают для ~60-70% соединений
- TURN сервер нужен для "сложных" NAT (symmetric NAT, corporate firewall, CGNAT)
- Без TURN ~30-40% звонков не смогут соединиться

### Варианты TURN серверов

| Вариант | Сложность | Стоимость | Надёжность |
|---------|-----------|-----------|------------|
| Публичный бесплатный TURN | Низкая | Бесплатно | Средняя (лимиты) |
| Self-hosted coturn | Средняя | VPS ~$5/мес | Высокая |
| Платный сервис (Twilio/Xirsys) | Низкая | ~$0.001/мин | Высокая |

---

## План реализации

### Фаза 1: Диагностика (приоритет!)

**Цель**: Понять, что именно не работает.

#### 1.1 Добавить логирование ICE states

Файл: [`web/webrtc/peer-connection.js`](web/webrtc/peer-connection.js)

```javascript
// Добавить в createPeerConnection()
this.connection.oniceconnectionstatechange = () => {
  console.log('[ICE] Connection state:', this.connection.iceConnectionState);
  console.log('[ICE] Gathering state:', this.connection.iceGatheringState);
};

this.connection.onicecandidate = (event) => {
  if (event.candidate) {
    console.log('[ICE] Candidate:', {
      type: event.candidate.type,
      protocol: event.candidate.protocol,
      address: event.candidate.address || event.candidate.ip,
      port: event.candidate.port
    });
  } else {
    console.log('[ICE] Gathering complete - all candidates collected');
  }
};
```

#### 1.2 Добавить логирование SDP

Файл: [`web/webrtc/peer-connection.js`](web/webrtc/peer-connection.js)

```javascript
// В createOffer() и createAnswer()
async createOffer() {
  // ... existing code ...
  console.log('[SDP] Offer created:', {
    hasAudio: offer.sdp.includes('m=audio'),
    hasVideo: offer.sdp.includes('m=video'),
    sdpLength: offer.sdp.length
  });
  return offer;
}
```

#### 1.3 Проверить обмен ICE candidates через WebSocket

Файл: [`web/webrtc/call-manager.js`](web/webrtc/call-manager.js)

```javascript
// В sendIceCandidate()
sendIceCandidate(targetUserId, candidate) {
  console.log('[WS] Sending ICE candidate to:', targetUserId);
  this.ws.send(JSON.stringify({
    type: 'call_ice_candidate',
    call_id: this.activeCall.id,
    target_user_id: targetUserId,
    candidate: candidate.toJSON()
  }));
}

// В handleIceCandidate()
handleIceCandidate(data) {
  console.log('[WS] Received ICE candidate from:', data.user_id);
  // ... existing code ...
}
```

### Фаза 2: Добавить TURN сервер

#### 2.1 Быстрое решение: Публичный TURN

Использовать OpenRelay (бесплатно, 10GB/мес):

```env
# .env или ICE_SERVERS environment variable
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:openrelay.metered.ca:80","username":"openrelayproject","credential":"openrelayproject"},{"urls":"turn:openrelay.metered.ca:443","username":"openrelayproject","credential":"openrelayproject"}]
```

#### 2.2 Постоянное решение: Self-hosted coturn

**Вариант A: На том же сервере (Min deployment)**

Добавить в [`docker-compose.yml`](docker-compose.yml):

```yaml
services:
  # ... existing services ...
  
  coturn:
    image: coturn/coturn:latest
    network_mode: host
    command:
      - -n
      - --realm=messenger.local
      - --fingerprint
      - --lt-cred-mech
      - --user=messenger:${TURN_SECRET}
      - --min-port=49152
      - --max-port=65535
      - --log-file=stdout
    restart: unless-stopped
```

**Вариант B: Отдельный сервер**

Создать Terraform конфигурацию для TURN сервера.

#### 2.3 Конфигурация клиента

Файл: [`internal/http/handler.go`](internal/http/handler.go) - уже поддерживает ICE_SERVERS env var.

Файл: [`web/webrtc/call-manager.js`](web/webrtc/call-manager.js) - уже получает конфиг через `/api/calls/ice-config`.

### Фаза 3: Улучшить UX

#### 3.1 Показывать реальное состояние соединения

Файл: [`web/webrtc/call-manager.js`](web/webrtc/call-manager.js)

```javascript
// Добавить событие для UI
this.connection.oniceconnectionstatechange = () => {
  window.dispatchEvent(new CustomEvent('callConnectionState', {
    detail: {
      userId: this.userId,
      state: this.connection.iceConnectionState
    }
  }));
};
```

Файл: [`web/app.js`](web/app.js)

```javascript
// Обновить UI при изменении состояния
callManager.on('callConnectionState', (data) => {
  if (data.state === 'connected') {
    showCallStatus('Соединено');
  } else if (data.state === 'checking') {
    showCallStatus('Подключение...');
  } else if (data.state === 'failed') {
    showCallStatus('Ошибка соединения');
    showRetryButton();
  }
});
```

#### 3.2 Добавить индикатор качества соединения

```javascript
// Показывать тип соединения
this.connection.onicecandidate = (event) => {
  if (event.candidate) {
    const type = event.candidate.type;
    // relay = через TURN (меньше качество, но работает)
    // srflx = через STUN (лучше качество)
    // host = прямое (лучшее качество)
    console.log('Connection type:', type);
  }
};
```

---

## Структура изменений

```
web/webrtc/
├── peer-connection.js    # + ICE logging, SDP logging
├── call-manager.js       # + connection state events
└── media-utils.js        # (без изменений)

internal/
├── config/config.go      # + TURN config (опционально)
└── http/handler.go       # (уже поддерживает ICE_SERVERS)

docker-compose.yml        # + coturn service (опционально)
.env.example              # + ICE_SERVERS example
```

---

## Очередность действий

1. **Сначала**: Добавить логирование ICE states (Фаза 1)
2. **Протестировать**: Открыть консоль, посмотреть ICE state
3. **Если ICE failed**: Добавить TURN сервер (Фаза 2)
4. **После**: Улучшить UX (Фаза 3)

---

## Ожидаемый результат

После добавления TURN сервера:
- 99% звонков будут успешно соединяться
- Аудио/видео будет передаваться
- UI будет показывать реальное состояние соединения

---

## Риски и митигация

| Риск | Митигация |
|------|-----------|
| TURN сервер недоступен | Fallback на STUN-only |
| Превышение лимита трафика | Мониторинг, алерты |
| Задержка через TURN relay | Показывать индикатор "relay" |

---

## Альтернативы TURN

Если TURN не подходит, есть альтернативы:

### 1. Ограничить использование
- Работает только в одной локальной сети
- Или только между пользователями с публичными IP

### 2. Использовать SFU (Selective Forwarding Unit)
- Mediasoup, Janus, LiveKit
- Требует отдельный сервер
- Лучше для групповых звонков

### 3. Использовать P2P с fallback
- Сначала пытаться P2P через STUN
- Если не удалось - показать ошибку с инструкцией

---

## Заключение

**TURN сервер необходим** для надёжной работы звонков в интернете.

**Рекомендуемый путь**:
1. Добавить диагностику ICE
2. Использовать публичный TURN для тестирования
3. Развернуть свой coturn для продакшена

**Минимальные изменения**:
- Добавить ICE_SERVERS с TURN конфигурацией
- Добавить логирование ICE states
- Показывать состояние соединения в UI
