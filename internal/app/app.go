package app

import (
	"context"
	"log"
	"net/http"

	"messenger/internal/auth"
	"messenger/internal/config"
	httphandlers "messenger/internal/http"
	"messenger/internal/service"
	"messenger/internal/storage"
	"messenger/internal/storage/postgres"
	"messenger/internal/ws"
)

type App struct {
	config  *config.Config
	storage *postgres.Storage
	hub     *ws.Hub
	router  http.Handler
}

func New(cfg *config.Config) *App {
	return &App{
		config: cfg,
	}
}

func (a *App) Init(ctx context.Context) error {
	// Try to connect to database, but don't fail if unavailable
	pgStorage, err := postgres.New(a.config.DB.DSN())
	if err != nil {
		log.Printf("warning: database connection failed: %v", err)
		log.Println("application starting without database - some features unavailable")
	} else if err := pgStorage.Ping(ctx); err != nil {
		pgStorage.Close()
		log.Printf("warning: database ping failed: %v", err)
		log.Println("application starting without database - some features unavailable")
	} else {
		a.storage = pgStorage
		log.Println("database connected")
	}

	// Initialize services with storage (may be nil)
	var userRepo storage.UserRepository
	var messageRepo storage.MessageRepository
	if pgStorage != nil {
		userRepo = pgStorage.User()
		messageRepo = pgStorage.Message()
	}

	authService := auth.NewService(userRepo, a.config.JWTSecret, a.config.JWTDuration)
	userService := service.NewUserService(userRepo)
	messageService := service.NewMessageService(messageRepo, userRepo)

	// Create default user if configured
	if a.config.DefaultUser != "" && a.config.DefaultPassword != "" {
		if err := a.ensureDefaultUser(ctx, authService); err != nil {
			log.Printf("warning: failed to create default user: %v", err)
		}
	}

	a.hub = ws.NewHub()
	go a.hub.Run()

	httpHandler := httphandlers.NewHandler(authService, userService, messageService)
	router := httpHandler.Router()

	// Add health check endpoint
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		status := "healthy"
		dbStatus := "connected"
		if a.storage == nil {
			status = "degraded"
			dbStatus = "disconnected"
		}
		w.Header().Set("Content-Type", "application/json")
		if a.storage == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		w.Write([]byte(`{"status":"` + status + `","database":"` + dbStatus + `"}`))
	})

	wsHandler := ws.NewHandler(a.hub, authService, messageService)
	router.Handle("/ws", wsHandler)

	a.router = router

	return nil
}

func (a *App) Router() http.Handler {
	return a.router
}

func (a *App) Shutdown(ctx context.Context) {
	if a.storage != nil {
		a.storage.Close()
	}
}

func (a *App) ensureDefaultUser(ctx context.Context, authService *auth.Service) error {
	if a.storage == nil {
		return nil
	}

	// Try to register the default user
	user, err := authService.Register(ctx, a.config.DefaultUser, a.config.DefaultPassword)
	if err != nil {
		// If user already exists, that's fine
		if err.Error() == "username already taken" {
			log.Printf("default user '%s' already exists", a.config.DefaultUser)
			return nil
		}
		return err
	}

	log.Printf("default user '%s' created with ID: %s", user.Username, user.ID)
	return nil
}
