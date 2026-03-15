# Calls Implementation Plan - Agent Guide

## Оглавление

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [WebSocket Protocol](#3-websocket-protocol)
4. [Database Schema](#4-database-schema)
5. [REST API](#5-rest-api)
6. [Project Structure](#6-project-structure)
7. [Implementation Phases](#7-implementation-phases)
8. [Frontend Modules](#8-frontend-modules)
9. [STUN/TURN Configuration](#9-stunturn-configuration)
10. [Screen Sharing](#10-screen-sharing)

---

## 1. Overview

| Feature | Details |
|---------|---------|
| Type | Group audio/video calls |
| Tech | WebRTC P2P (mesh topology) |
| Signalling | Existing WebSocket server |
| Max Participants | 5-8 |
| No new dependencies | Uses native browser APIs |

---

## 2. Architecture

```
Client A (WebRTC) ↔ Client B (WebRTC)
   ↓                    ↓
Client C (WebRTC) ↔ Server (WebSocket Signalling)
```

**Signalling Flow:**
1. Caller sends `call_offer` → Server → Callees
2. Callees respond with `call_answer` → Server → Caller
3. All exchange `call_ice_candidate` via Server
4. P2P connection established

---

## 3. WebSocket Protocol

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `call_start` | Caller → Server | Start call with participants |
| `call_offer` | Any → Server → Others | SDP offer |
| `call_answer` | Any → Server → Others | SDP answer |
| `call_ice_candidate` | Any → Server → Others | ICE candidate |
| `call_join` | User → Server | Join call |
| `call_leave` | User → Server | Leave call |
| `call_end` | Caller → Server | End call |
| `call_reject` | Callee → Server | Reject call |
| `call_state` | Server → All | Call state update |

### Example Messages

```json
// call_start
{"type":"call_start","call_id":"uuid","call_type":"audio","participants":["uuid1","uuid2"]}

// call_offer
{"type":"call_offer","call_id":"uuid","caller_id":"uuid","sdp":"v=0...","call_type":"audio"}

// call_answer
{"type":"call_answer","call_id":"uuid","callee_id":"uuid","sdp":"v=0..."}

// call_ice_candidate
{"type":"call_ice_candidate","call_id":"uuid","user_id":"uuid","candidate":{"candidate":"...","sdpMid":"0","sdpMLineIndex":0}}
```

---

## 4. Database Schema

### New Tables

```sql
-- calls
CREATE TABLE calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiator_id UUID NOT NULL REFERENCES users(id),
    call_type VARCHAR(10) NOT NULL CHECK (call_type IN ('audio', 'video')),
    status VARCHAR(20) NOT NULL DEFAULT 'ringing',
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- call_participants
CREATE TABLE call_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id),
    user_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'invited',
    joined_at TIMESTAMP,
    left_at TIMESTAMP,
    audio_enabled BOOLEAN DEFAULT true,
    video_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(call_id, user_id)
);
```

### Go Models

```go
type CallType string
const (CallTypeAudio CallType = "audio"; CallTypeVideo CallType = "video")

type CallStatus string
const (CallStatusRinging CallStatus = "ringing"; CallStatusActive CallStatus = "active"; CallStatusEnded CallStatus = "ended")

type Call struct {
    ID          uuid.UUID  `json:"id"`
    InitiatorID uuid.UUID  `json:"initiator_id"`
    CallType    CallType   `json:"call_type"`
    Status      CallStatus `json:"status"`
    StartedAt   *time.Time `json:"started_at,omitempty"`
    EndedAt     *time.Time `json:"ended_at,omitempty"`
    CreatedAt   time.Time  `json:"created_at"`
}

type CallParticipant struct {
    ID           uuid.UUID         `json:"id"`
    CallID       uuid.UUID         `json:"call_id"`
    UserID       uuid.UUID         `json:"user_id"`
    Status       ParticipantStatus `json:"status"`
    JoinedAt     *time.Time        `json:"joined_at,omitempty"`
    LeftAt       *time.Time        `json:"left_at,omitempty"`
    AudioEnabled bool              `json:"audio_enabled"`
    VideoEnabled bool              `json:"video_enabled"`
    CreatedAt    time.Time         `json:"created_at"`
}
```

---

## 5. REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/calls` | Create new call |
| GET | `/api/calls/{id}` | Get call info |
| POST | `/api/calls/{id}/join` | Join call |
| POST | `/api/calls/{id}/leave` | Leave call |
| POST | `/api/calls/{id}/end` | End call (initiator only) |
| GET | `/api/calls/history` | Get call history |

---

## 6. Project Structure

### New Files

```
internal/
├── model/
│   └── call.go                    # Models
├── service/
│   └── call.go                    # Business logic
├── storage/
│   ├── interfaces.go              # + CallRepository
│   └── postgres/
│       └── storage.go             # + CallRepo
├── ws/
│   ├── handler.go                 # + call handlers
│   ├── hub.go                     # + call state
│   └── call_signaling.go          # NEW
└── migrations/
    └── 005_calls.sql              # NEW

web/
├── index.html                     # + call UI
├── app.js                         # + WebRTC logic
├── style.css                      # + call styles
└── webrtc/
    ├── peer-connection.js         # NEW
    ├── call-manager.js            # NEW
    └── media-utils.js             # NEW
```

---

## 7. Implementation Phases

### Phase 1: Backend Core
1. Create [`internal/model/call.go`](internal/model/call.go)
2. Create [`internal/migrations/005_calls.sql`](internal/migrations/005_calls.sql)
3. Update [`internal/storage/interfaces.go`](internal/storage/interfaces.go)
4. Implement [`internal/storage/postgres/storage.go`](internal/storage/postgres/storage.go)
5. Create [`internal/service/call.go`](internal/service/call.go)

### Phase 2: Signalling
1. Update [`internal/ws/hub.go`](internal/ws/hub.go) - add message types
2. Create [`internal/ws/call_signaling.go`](internal/ws/call_signaling.go)
3. Update [`internal/ws/handler.go`](internal/ws/handler.go)
4. Update [`internal/http/handler.go`](internal/http/handler.go)

### Phase 3: Frontend WebRTC
1. Create `web/webrtc/` modules
2. Update [`web/index.html`](web/index.html)
3. Update [`web/style.css`](web/style.css)
4. Update [`web/app.js`](web/app.js)

---

## 8. Frontend Modules

### peer-connection.js
```javascript
class PeerConnection {
  constructor(userId, callType) {
    this.userId = userId;
    this.callType = callType;
    this.connection = null;
    this.localStream = null;
    this.remoteStream = null;
  }
  
  async createOffer() { ... }
  async createAnswer(offer) { ... }
  async setRemoteDescription(sdp) { ... }
  async addIceCandidate(candidate) { ... }
  async getLocalStream() { ... }
  close() { ... }
}
```

### call-manager.js
```javascript
class CallManager {
  constructor(webSocket) {
    this.ws = webSocket;
    this.activeCall = null;
    this.peerConnections = new Map();
  }
  
  async startCall(participantIds, callType) { ... }
  async joinCall(callId) { ... }
  async leaveCall() { ... }
  async endCall() { ... }
  
  handleOffer(data) { ... }
  handleAnswer(data) { ... }
  handleIceCandidate(data) { ... }
}
```

---

## 9. STUN/TURN Configuration

### Required for NAT Traversal

```javascript
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
```

### For Production
- Use public STUN servers (Google/Cloudflare)
- Add TURN server (coturn) for complex NAT scenarios

---

## 10. Screen Sharing

### New Message Types

| Type | Description |
|------|-------------|
| `screen_share_start` | Start sharing |
| `screen_share_offer` | SDP offer for screen |
| `screen_share_answer` | SDP answer for screen |
| `screen_share_ice_candidate` | ICE candidate for screen |
| `screen_share_stop` | Stop sharing |

### UI Controls
```html
<button class="btn-screen" onclick="toggleScreenShare()">🖥️</button>
```

### CSS
```css
.screen-share-container {
  grid-column: span 2;
  grid-row: span 2;
  background: #1a1a1a;
}
```

---

## Quick Reference

| Task | File(s) |
|------|---------|
| Add new message type | Update `internal/ws/hub.go`, `internal/ws/handler.go` |
| Add new API endpoint | Update `internal/http/handler.go`, `internal/service/call.go` |
| Add new DB table | Create `internal/migrations/00X_calls.sql` |
| Add WebRTC module | Create `web/webrtc/*.js` |
| Add UI component | Update `web/index.html`, `web/style.css` |

---

**Last Updated**: 2026-03-14  
**Version**: 1.0  
**Maintainer**: AI Assistant
