package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"messenger/internal/app"
	"messenger/internal/config"
)

func main() {
	cfg := config.Load()

	application := app.New(cfg)
	if err := application.Init(context.Background()); err != nil {
		log.Fatalf("failed to initialize app: %v", err)
	}

	server := &http.Server{
		Addr:         cfg.HTTPAddr,
		Handler:      application.Router(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	done := make(chan bool, 1)
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("server shutdown error: %v", err)
		}

		application.Shutdown(ctx)
		done <- true
	}()

	log.Printf("server starting on %s", cfg.HTTPAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}

	<-done
	log.Println("server stopped")
}
