package postgres

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strings"
)

type Migration struct {
	Name string
	SQL  string
}

func (s *Storage) RunMigrations(ctx context.Context, migrationsFS fs.FS) error {
	if _, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	migrations, err := loadMigrations(migrationsFS)
	if err != nil {
		return fmt.Errorf("failed to load migrations: %w", err)
	}

	for _, m := range migrations {
		var exists bool
		err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", m.Name).Scan(&exists)
		if err != nil {
			return fmt.Errorf("failed to check migration %s: %w", m.Name, err)
		}
		if exists {
			continue
		}

		if _, err := s.pool.Exec(ctx, m.SQL); err != nil {
			return fmt.Errorf("failed to apply migration %s: %w", m.Name, err)
		}

		if _, err := s.pool.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", m.Name); err != nil {
			return fmt.Errorf("failed to record migration %s: %w", m.Name, err)
		}
	}

	return nil
}

func loadMigrations(migrationsFS fs.FS) ([]Migration, error) {
	var migrations []Migration

	err := fs.WalkDir(migrationsFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".sql") {
			return nil
		}

		content, err := fs.ReadFile(migrationsFS, path)
		if err != nil {
			return fmt.Errorf("failed to read migration %s: %w", path, err)
		}

		migrations = append(migrations, Migration{
			Name: path,
			SQL:  string(content),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Name < migrations[j].Name
	})

	return migrations, nil
}
