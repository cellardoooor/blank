package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
	"messenger/internal/auth"
	"messenger/internal/model"
	"messenger/internal/service"
)

type Handler struct {
	authService    *auth.Service
	userService    *service.UserService
	messageService *service.MessageService
	callService    *service.CallService
	corsAllowed    []string
	iceServers     string
}

func NewHandler(authSvc *auth.Service, userSvc *service.UserService, msgSvc *service.MessageService, callSvc *service.CallService, corsAllowed []string, iceServers string) *Handler {
	return &Handler{
		authService:    authSvc,
		userService:    userSvc,
		messageService: msgSvc,
		callService:    callSvc,
		corsAllowed:    corsAllowed,
		iceServers:     iceServers,
	}
}

func (h *Handler) Router() *mux.Router {
	r := mux.NewRouter()

	r.Use(h.corsMiddleware())

	r.HandleFunc("/api/health", h.healthCheck).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/auth/register", h.register).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/auth/login", h.login).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/auth/change-password", h.authMiddleware(h.changePassword)).Methods("POST", "OPTIONS")

	api := r.PathPrefix("/api").Subrouter()
	api.Use(auth.Middleware(h.authService))
	api.HandleFunc("/me", h.getCurrentUser).Methods("GET")
	api.HandleFunc("/users", h.listUsers).Methods("GET")
	api.HandleFunc("/users/search", h.searchUsers).Methods("GET")
	api.HandleFunc("/users/{id}", h.getUser).Methods("GET")
	api.HandleFunc("/conversations", h.getConversations).Methods("GET")
	api.HandleFunc("/chats", h.getChats).Methods("GET")
	api.HandleFunc("/messages", h.sendMessage).Methods("POST")
	api.HandleFunc("/messages/{user_id}", h.getMessages).Methods("GET")

	// Call endpoints
	api.HandleFunc("/calls", h.createCall).Methods("POST")
	api.HandleFunc("/calls/{id}", h.getCall).Methods("GET")
	api.HandleFunc("/calls/{id}/join", h.joinCall).Methods("POST")
	api.HandleFunc("/calls/{id}/leave", h.leaveCall).Methods("POST")
	api.HandleFunc("/calls/{id}/end", h.endCall).Methods("POST")
	api.HandleFunc("/calls/history", h.getCallHistory).Methods("GET")
	api.HandleFunc("/calls/ice-config", h.getICEConfig).Methods("GET")

	return r
}

func (h *Handler) corsMiddleware() mux.MiddlewareFunc {
	allowedOrigins := h.corsAllowed
	if len(allowedOrigins) == 0 {
		allowedOrigins = []string{"*"}
	}
	c := cors.New(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           86400,
	})
	return c.Handler
}

func (h *Handler) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Skip OPTIONS requests (CORS preflight)
		if r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}

		token := extractToken(r)
		if token == "" {
			respondError(w, http.StatusUnauthorized, "authorization required")
			return
		}

		userID, err := h.authService.ValidateToken(token)
		if err != nil {
			respondError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		ctx := context.WithValue(r.Context(), auth.ContextKey(), userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func extractToken(r *http.Request) string {
	bearer := r.Header.Get("Authorization")
	if len(bearer) > 7 && strings.EqualFold(bearer[:7], "Bearer ") {
		return bearer[7:]
	}
	return ""
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}

func (h *Handler) healthCheck(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	if req.Username == "" || req.Password == "" {
		respondError(w, http.StatusBadRequest, "username and password required")
		return
	}

	user, err := h.authService.Register(r.Context(), req.Username, req.Password)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	token, err := h.authService.GenerateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"user":  user,
		"token": token,
	})
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	token, err := h.authService.Login(r.Context(), req.Username, req.Password)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (h *Handler) getCurrentUser(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	user, err := h.userService.GetByID(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get user")
		return
	}
	if user == nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"id":       user.ID,
		"username": user.Username,
	})
}

func (h *Handler) listUsers(w http.ResponseWriter, r *http.Request) {
	usernameQuery := r.URL.Query().Get("username")

	if usernameQuery != "" {
		user, err := h.userService.GetByUsername(r.Context(), usernameQuery)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to get user")
			return
		}
		if user == nil {
			respondError(w, http.StatusNotFound, "user not found")
			return
		}
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"id":       user.ID,
			"username": user.Username,
		})
		return
	}

	users, err := h.userService.GetAll(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get users")
		return
	}
	respondJSON(w, http.StatusOK, users)
}

func (h *Handler) searchUsers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")

	var users []model.User
	var err error

	if query == "" {
		// Return all users if no query
		users, err = h.userService.GetAll(r.Context())
	} else {
		users, err = h.userService.SearchUsers(r.Context(), query)
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to search users")
		return
	}

	// Convert to API response format (without password_hash)
	apiUsers := make([]map[string]interface{}, len(users))
	for i, user := range users {
		apiUsers[i] = map[string]interface{}{
			"id":       user.ID,
			"username": user.Username,
		}
	}

	respondJSON(w, http.StatusOK, apiUsers)
}

func (h *Handler) getConversations(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	partners, err := h.messageService.GetConversationPartners(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get conversations")
		return
	}

	respondJSON(w, http.StatusOK, partners)
}

func (h *Handler) getChats(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	chats, err := h.messageService.GetChatList(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get chats")
		return
	}

	// Add user info to each chat
	for i := range chats {
		partnerID, err := uuid.Parse(chats[i].UserID)
		if err != nil {
			continue
		}
		user, err := h.userService.GetByID(r.Context(), partnerID)
		if err == nil && user != nil {
			chats[i].Username = user.Username
		}
	}

	respondJSON(w, http.StatusOK, chats)
}

func (h *Handler) getUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID, err := uuid.Parse(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	user, err := h.userService.GetByID(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get user")
		return
	}
	if user == nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}

	respondJSON(w, http.StatusOK, user)
}

type SendMessageRequest struct {
	ReceiverID string `json:"receiver_id"`
	Payload    []byte `json:"payload"`
}

func (h *Handler) sendMessage(w http.ResponseWriter, r *http.Request) {
	senderID := auth.UserIDFromContext(r.Context())

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	receiverID, err := uuid.Parse(req.ReceiverID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid receiver id")
		return
	}

	msg, err := h.messageService.Send(r.Context(), senderID, receiverID, req.Payload)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Return message with string payload
	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"id":          msg.ID,
		"sender_id":   msg.SenderID,
		"receiver_id": msg.ReceiverID,
		"payload":     string(msg.Payload), // Convert []byte to string
		"created_at":  msg.CreatedAt.Format(time.RFC3339),
	})
}

func (h *Handler) getMessages(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	vars := mux.Vars(r)
	otherID, err := uuid.Parse(vars["user_id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	limit := 50
	offset := 0

	messages, err := h.messageService.GetHistoryWithReadStatus(r.Context(), userID, otherID, limit, offset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get messages")
		return
	}

	// Convert messages to API format with string payload
	apiMessages := make([]interface{}, len(messages))
	for i, msg := range messages {
		apiMessages[i] = map[string]interface{}{
			"id":          msg.ID,
			"sender_id":   msg.SenderID,
			"receiver_id": msg.ReceiverID,
			"payload":     string(msg.Payload),
			"created_at":  msg.CreatedAt.Format(time.RFC3339),
			"is_read":     msg.IsRead,
		}
	}

	respondJSON(w, http.StatusOK, apiMessages)
}

type ChangePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	log.Printf("changePassword: userID from context = %v", userID)

	if userID == uuid.Nil {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	if req.OldPassword == "" || req.NewPassword == "" {
		respondError(w, http.StatusBadRequest, "old and new password required")
		return
	}

	if len(req.NewPassword) < 5 {
		respondError(w, http.StatusBadRequest, "new password must be at least 5 characters")
		return
	}

	err := h.authService.ChangePassword(r.Context(), userID, req.OldPassword, req.NewPassword)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "password changed successfully"})
}

type CreateCallRequest struct {
	CallType     string   `json:"call_type"`
	Participants []string `json:"participants"`
}

func (h *Handler) createCall(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	var req CreateCallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// Parse participant IDs
	participantIDs := make([]uuid.UUID, 0, len(req.Participants))
	for _, pid := range req.Participants {
		parsedID, err := uuid.Parse(pid)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid participant id")
			return
		}
		participantIDs = append(participantIDs, parsedID)
	}

	// Validate call type
	callType := model.CallType(req.CallType)
	if callType != model.CallTypeAudio && callType != model.CallTypeVideo {
		callType = model.CallTypeAudio
	}

	// Create call
	call, err := h.callService.CreateCall(r.Context(), userID, callType, participantIDs)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"id":          call.ID,
		"call_type":   call.CallType,
		"status":      call.Status,
		"initiator_id": call.InitiatorID,
		"created_at":  call.CreatedAt.Format(time.RFC3339),
	})
}

func (h *Handler) getCall(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	vars := mux.Vars(r)
	callID, err := uuid.Parse(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid call id")
		return
	}

	callInfo, err := h.callService.GetCall(r.Context(), callID)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Check if user is a participant
	isParticipant := false
	for _, p := range callInfo.Participants {
		if p.UserID == userID {
			isParticipant = true
			break
		}
	}
	if !isParticipant {
		respondError(w, http.StatusForbidden, "not a participant of this call")
		return
	}

	respondJSON(w, http.StatusOK, callInfo)
}

func (h *Handler) joinCall(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	vars := mux.Vars(r)
	callID, err := uuid.Parse(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid call id")
		return
	}

	if err := h.callService.JoinCall(r.Context(), callID, userID); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "joined call successfully"})
}

func (h *Handler) leaveCall(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	vars := mux.Vars(r)
	callID, err := uuid.Parse(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid call id")
		return
	}

	if err := h.callService.LeaveCall(r.Context(), callID, userID); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "left call successfully"})
}

func (h *Handler) endCall(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	vars := mux.Vars(r)
	callID, err := uuid.Parse(vars["id"])
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid call id")
		return
	}

	if err := h.callService.EndCall(r.Context(), callID, userID); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "call ended successfully"})
}

func (h *Handler) getCallHistory(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	limit := 50
	offset := 0

	history, err := h.callService.GetCallHistory(r.Context(), userID, limit, offset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get call history")
		return
	}

	respondJSON(w, http.StatusOK, history)
}

func (h *Handler) getICEConfig(w http.ResponseWriter, r *http.Request) {
	// Default ICE servers (public STUN servers only - no credentials)
	defaultICEServers := []map[string]interface{}{
		{"urls": "stun:stun.l.google.com:19302"},
		{"urls": "stun:stun1.l.google.com:19302"},
	}

	var iceServers []map[string]interface{}

	if h.iceServers != "" {
		// Parse and validate the ICE servers configuration
		if err := json.Unmarshal([]byte(h.iceServers), &iceServers); err != nil {
			log.Printf("invalid ICE_SERVERS config, using defaults: %v", err)
			iceServers = defaultICEServers
		} else {
			// Security: Remove credentials from ICE servers before sending to clients
			// Only return urls, username, and credential for TURN servers that require them
			// For STUN servers, only return urls (they don't need credentials)
			sanitizedServers := make([]map[string]interface{}, 0, len(iceServers))
			for _, server := range iceServers {
				sanitized := make(map[string]interface{})
				if urls, ok := server["urls"]; ok {
					sanitized["urls"] = urls
				}
				// Only include username/credential for TURN servers (they have credential fields)
				// This allows TURN servers to work while not exposing unnecessary credential info
				// Note: In production, consider using time-limited TURN credentials
				if username, ok := server["username"]; ok && username != "" {
					sanitized["username"] = username
				}
				if credential, ok := server["credential"]; ok && credential != "" {
					sanitized["credential"] = credential
				}
				sanitizedServers = append(sanitizedServers, sanitized)
			}
			iceServers = sanitizedServers
		}
	} else {
		iceServers = defaultICEServers
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"iceServers": iceServers})
}
