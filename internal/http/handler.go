package http

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"messenger/internal/auth"
	"messenger/internal/service"
)

type Handler struct {
	authService    *auth.Service
	userService    *service.UserService
	messageService *service.MessageService
}

func NewHandler(authSvc *auth.Service, userSvc *service.UserService, msgSvc *service.MessageService) *Handler {
	return &Handler{
		authService:    authSvc,
		userService:    userSvc,
		messageService: msgSvc,
	}
}

func (h *Handler) Router() *mux.Router {
	r := mux.NewRouter()

	r.HandleFunc("/api/health", h.healthCheck).Methods("GET")
	r.HandleFunc("/api/auth/register", h.register).Methods("POST")
	r.HandleFunc("/api/auth/login", h.login).Methods("POST")

	api := r.PathPrefix("/api").Subrouter()
	api.Use(auth.Middleware(h.authService))
	api.HandleFunc("/me", h.getCurrentUser).Methods("GET")
	api.HandleFunc("/users", h.listUsers).Methods("GET")
	api.HandleFunc("/users/{id}", h.getUser).Methods("GET")
	api.HandleFunc("/conversations", h.getConversations).Methods("GET")
	api.HandleFunc("/chats", h.getChats).Methods("GET")
	api.HandleFunc("/messages", h.sendMessage).Methods("POST")
	api.HandleFunc("/messages/{user_id}", h.getMessages).Methods("GET")

	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./web/")))

	return r
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
		respondJSON(w, http.StatusOK, user)
		return
	}

	users, err := h.userService.GetAll(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get users")
		return
	}
	respondJSON(w, http.StatusOK, users)
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

	respondJSON(w, http.StatusCreated, msg)
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

	messages, err := h.messageService.GetHistory(r.Context(), userID, otherID, limit, offset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to get messages")
		return
	}

	respondJSON(w, http.StatusOK, messages)
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}
