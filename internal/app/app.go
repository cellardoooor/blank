package app

import (
	"context"
	"log"
	"net/http"

	"messenger/internal/auth"
	httphandlers "messenger/internal/http"
	"messenger/internal/config"
	"messenger/internal/service"
	"messenger/internal/storage/postgres"
	"messenger/internal/ws"
)

type App struct {
	config   *config.Config
	storage  *postgres.Storage
	hub      *ws.Hub
	router   http.Handler
}

func New(cfg *config.Config) *App {
	return &App{
		config: cfg,
	}
}

func (a *App) Init(ctx context.Context) error {
	storage, err := postgres.New(a.config.DB.DSN())
	if err != nil {
		return err
	}

	if err := storage.Ping(ctx); err != nil {
		storage.Close()
		return err
	}

	a.storage = storage
	log.Println("database connected")

	authService := auth.NewService(storage.User(), a.config.JWTSecret, a.config.JWTDuration)
	userService := service.NewUserService(storage.User())
	messageService := service.NewMessageService(storage.Message(), storage.User())

	a.hub = ws.NewHub()
	go a.hub.Run()

	httpHandler := httphandlers.NewHandler(authService, userService, messageService)
	router := httpHandler.Router()

	wsHandler := ws.NewHandler(a.hub, authService)
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
