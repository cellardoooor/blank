package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"messenger/internal/model"
	"messenger/internal/storage"
)

type CallService struct {
	repo     storage.CallRepository
	userRepo storage.UserRepository
	txm      storage.TransactionManager
}

// ErrInvalidDependency is returned when a required dependency is nil
var ErrInvalidDependency = errors.New("required dependency is nil")

func NewCallService(repo storage.CallRepository, userRepo storage.UserRepository, txm storage.TransactionManager) (*CallService, error) {
	if repo == nil {
		return nil, fmt.Errorf("%w: CallRepository", ErrInvalidDependency)
	}
	if userRepo == nil {
		return nil, fmt.Errorf("%w: UserRepository", ErrInvalidDependency)
	}
	if txm == nil {
		return nil, fmt.Errorf("%w: TransactionManager", ErrInvalidDependency)
	}
	return &CallService{
		repo:     repo,
		userRepo: userRepo,
		txm:      txm,
	}, nil
}

func (s *CallService) CreateCall(ctx context.Context, initiatorID uuid.UUID, callType model.CallType, participantIDs []uuid.UUID) (*model.Call, error) {

	// Deduplicate participant IDs and exclude initiator
	seen := make(map[uuid.UUID]bool)
	uniqueParticipants := make([]uuid.UUID, 0, len(participantIDs))
	for _, pid := range participantIDs {
		if pid == initiatorID || seen[pid] {
			continue
		}
		seen[pid] = true
		uniqueParticipants = append(uniqueParticipants, pid)
	}

	// Validate participants exist (batch query to avoid N+1)
	if len(uniqueParticipants) > 0 {
		users, err := s.userRepo.GetByIDs(ctx, uniqueParticipants)
		if err != nil {
			return nil, fmt.Errorf("failed to lookup participants: %w", err)
		}
		// Create a set of found user IDs
		foundIDs := make(map[uuid.UUID]bool)
		for _, u := range users {
			foundIDs[u.ID] = true
		}
		// Check all participants were found
		for _, pid := range uniqueParticipants {
			if !foundIDs[pid] {
				return nil, fmt.Errorf("participant %s does not exist", pid)
			}
		}
	}

	call := &model.Call{
		ID:          uuid.New(),
		InitiatorID: initiatorID,
		CallType:    callType,
		Status:      model.CallStatusRinging,
		CreatedAt:   time.Now(),
	}

	// Transaction support is required for atomic call creation
	if s.txm == nil {
		return nil, fmt.Errorf("transaction support required for call creation - database may be unavailable")
	}

	var createdCall *model.Call
	err := s.txm.WithTx(ctx, func(txCtx context.Context) error {
		if err := s.repo.Create(txCtx, call); err != nil {
			return fmt.Errorf("failed to create call: %w", err)
		}

		// Add initiator as participant
		initiatorParticipant := &model.CallParticipant{
			ID:           uuid.New(),
			CallID:       call.ID,
			UserID:       initiatorID,
			Status:       model.CallParticipantStatusActive,
			JoinedAt:     &call.CreatedAt,
			AudioEnabled: true,
			VideoEnabled: callType == model.CallTypeVideo,
			CreatedAt:    call.CreatedAt,
		}
		if err := s.repo.CreateParticipant(txCtx, initiatorParticipant); err != nil {
			return fmt.Errorf("failed to add initiator as participant: %w", err)
		}

		// Add other participants
		for _, pid := range uniqueParticipants {
			participant := &model.CallParticipant{
				ID:           uuid.New(),
				CallID:       call.ID,
				UserID:       pid,
				Status:       model.CallParticipantStatusInvited,
				AudioEnabled: true,
				VideoEnabled: callType == model.CallTypeVideo,
				CreatedAt:    call.CreatedAt,
			}
			if err := s.repo.CreateParticipant(txCtx, participant); err != nil {
				return fmt.Errorf("failed to add participant %s: %w", pid, err)
			}
		}

		createdCall = call
		return nil
	})
	if err != nil {
		return nil, err
	}

	return createdCall, nil
}

func (s *CallService) GetCall(ctx context.Context, callID uuid.UUID) (*model.CallInfo, error) {
	call, err := s.repo.GetByID(ctx, callID)
	if err != nil {
		return nil, fmt.Errorf("failed to get call: %w", err)
	}
	if call == nil {
		return nil, fmt.Errorf("call not found")
	}

	participants, err := s.repo.GetParticipantsByCallID(ctx, callID)
	if err != nil {
		return nil, fmt.Errorf("failed to get participants: %w", err)
	}

	return &model.CallInfo{
		Call:         *call,
		Participants: participants,
	}, nil
}

func (s *CallService) JoinCall(ctx context.Context, callID, userID uuid.UUID) error {
	call, err := s.repo.GetByID(ctx, callID)
	if err != nil {
		return fmt.Errorf("failed to get call: %w", err)
	}
	if call == nil {
		return fmt.Errorf("call not found")
	}

	// Check if user is already a participant
	participant, err := s.repo.GetParticipant(ctx, callID, userID)
	if err != nil {
		return fmt.Errorf("failed to check participant: %w", err)
	}

	if participant != nil {
		if participant.Status == model.CallParticipantStatusLeft {
			// Allow rejoin if the call is still active (user may have been disconnected)
			if call.Status == model.CallStatusActive {
				if err := s.repo.UpdateParticipantStatus(ctx, callID, userID, string(model.CallParticipantStatusActive)); err != nil {
					return fmt.Errorf("failed to update participant status: %w", err)
				}
				joinedAt := time.Now()
				if err := s.repo.UpdateParticipantJoinedAt(ctx, callID, userID, &joinedAt); err != nil {
					return fmt.Errorf("failed to update joined_at: %w", err)
				}
			} else {
				return fmt.Errorf("cannot rejoin a call that has ended")
			}
		} else if participant.Status == model.CallParticipantStatusActive {
			return nil // Already joined
		} else {
			// Status is "invited" or "rejected" - update to active
			if err := s.repo.UpdateParticipantStatus(ctx, callID, userID, string(model.CallParticipantStatusActive)); err != nil {
				return fmt.Errorf("failed to update participant status: %w", err)
			}
			joinedAt := time.Now()
			if err := s.repo.UpdateParticipantJoinedAt(ctx, callID, userID, &joinedAt); err != nil {
				return fmt.Errorf("failed to update joined_at: %w", err)
			}
		}
	} else {
		// User not in call - check if they were invited
		return fmt.Errorf("user not invited to this call")
	}

	// Update call status to active if ringing
	if call.Status == model.CallStatusRinging {
		if err := s.repo.UpdateStatus(ctx, callID, string(model.CallStatusActive)); err != nil {
			return fmt.Errorf("failed to update call status: %w", err)
		}
		startedAt := time.Now()
		if err := s.repo.UpdateStartedAt(ctx, callID, &startedAt); err != nil {
			return fmt.Errorf("failed to update started_at: %w", err)
		}
	}

	return nil
}

func (s *CallService) LeaveCall(ctx context.Context, callID, userID uuid.UUID) error {
	participant, err := s.repo.GetParticipant(ctx, callID, userID)
	if err != nil {
		return fmt.Errorf("failed to get participant: %w", err)
	}
	if participant == nil {
		return fmt.Errorf("user is not a participant of this call")
	}

	if err := s.repo.UpdateParticipantStatus(ctx, callID, userID, string(model.CallParticipantStatusLeft)); err != nil {
		return fmt.Errorf("failed to update participant status: %w", err)
	}

	leftAt := time.Now()
	if err := s.repo.UpdateParticipantLeftAt(ctx, callID, userID, &leftAt); err != nil {
		return fmt.Errorf("failed to update left_at: %w", err)
	}

	// Check if call should be ended
	participants, err := s.repo.GetParticipantsByCallID(ctx, callID)
	if err != nil {
		return fmt.Errorf("failed to get participants: %w", err)
	}

	// Count active participants
	activeCount := 0
	for _, p := range participants {
		if p.Status == model.CallParticipantStatusActive {
			activeCount++
		}
	}

	// If no active participants left, end the call
	if activeCount == 0 {
		if err := s.repo.UpdateStatus(ctx, callID, string(model.CallStatusEnded)); err != nil {
			return fmt.Errorf("failed to update call status: %w", err)
		}
		endedAt := time.Now()
		if err := s.repo.UpdateEndedAt(ctx, callID, &endedAt); err != nil {
			return fmt.Errorf("failed to update ended_at: %w", err)
		}
	}

	return nil
}

func (s *CallService) EndCall(ctx context.Context, callID, userID uuid.UUID) error {
	call, err := s.repo.GetByID(ctx, callID)
	if err != nil {
		return fmt.Errorf("failed to get call: %w", err)
	}
	if call == nil {
		return fmt.Errorf("call not found")
	}

	// Check if user is the initiator or an active participant in the call
	participant, err := s.repo.GetParticipant(ctx, callID, userID)
	if err != nil {
		return fmt.Errorf("failed to get participant: %w", err)
	}

	// Allow initiator to end the call regardless of their participant status
	isInitiator := call.InitiatorID == userID

	if participant == nil && !isInitiator {
		return fmt.Errorf("user is not a participant of this call")
	}
	if participant != nil && participant.Status != model.CallParticipantStatusActive && !isInitiator {
		return fmt.Errorf("only active participants or the initiator can end the call")
	}

	// Get all participants before the transaction
	participants, err := s.repo.GetParticipantsByCallID(ctx, callID)
	if err != nil {
		return fmt.Errorf("failed to get participants: %w", err)
	}

	leftAt := time.Now()

	// Transaction support is required for atomic call ending
	return s.txm.WithTx(ctx, func(txCtx context.Context) error {
		for _, p := range participants {
			if p.Status == model.CallParticipantStatusActive {
				if err := s.repo.UpdateParticipantStatus(txCtx, callID, p.UserID, string(model.CallParticipantStatusLeft)); err != nil {
					return fmt.Errorf("failed to update participant %s status: %w", p.UserID, err)
				}
				if err := s.repo.UpdateParticipantLeftAt(txCtx, callID, p.UserID, &leftAt); err != nil {
					return fmt.Errorf("failed to update participant %s left_at: %w", p.UserID, err)
				}
			}
		}

		if err := s.repo.UpdateStatus(txCtx, callID, string(model.CallStatusEnded)); err != nil {
			return fmt.Errorf("failed to update call status: %w", err)
		}
		if err := s.repo.UpdateEndedAt(txCtx, callID, &leftAt); err != nil {
			return fmt.Errorf("failed to update ended_at: %w", err)
		}
		return nil
	})
}

func (s *CallService) RejectCall(ctx context.Context, callID, userID uuid.UUID) error {
	// Transaction support is required for atomic reject operation
	return s.txm.WithTx(ctx, func(txCtx context.Context) error {
		participant, err := s.repo.GetParticipant(txCtx, callID, userID)
		if err != nil {
			return fmt.Errorf("failed to get participant: %w", err)
		}
		if participant == nil {
			return fmt.Errorf("user is not a participant of this call")
		}

		// Skip if already rejected
		if participant.Status == model.CallParticipantStatusRejected {
			return nil
		}

		if err := s.repo.UpdateParticipantStatus(txCtx, callID, userID, string(model.CallParticipantStatusRejected)); err != nil {
			return fmt.Errorf("failed to update participant status: %w", err)
		}

		// Check if call should be ended (all invited participants have rejected or no one left to answer)
		participants, err := s.repo.GetParticipantsByCallID(txCtx, callID)
		if err != nil {
			return fmt.Errorf("failed to get participants: %w", err)
		}

		// Count invited participants (those who haven't responded yet)
		invitedCount := 0
		for _, p := range participants {
			if p.Status == model.CallParticipantStatusInvited {
				invitedCount++
			}
		}

		// If no invited participants remain (all rejected or joined), end the call
		if invitedCount == 0 {
			if err := s.repo.UpdateStatus(txCtx, callID, string(model.CallStatusEnded)); err != nil {
				return fmt.Errorf("failed to update call status: %w", err)
			}
			endedAt := time.Now()
			if err := s.repo.UpdateEndedAt(txCtx, callID, &endedAt); err != nil {
				return fmt.Errorf("failed to update ended_at: %w", err)
			}
		}

		return nil
	})
}

func (s *CallService) GetCallHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]model.CallHistoryItem, error) {
	return s.repo.GetCallHistory(ctx, userID, limit, offset)
}

func (s *CallService) UpdateParticipantMediaSettings(ctx context.Context, callID, userID uuid.UUID, audioEnabled, videoEnabled bool) error {
	return s.repo.UpdateParticipantMediaSettings(ctx, callID, userID, audioEnabled, videoEnabled)
}

func (s *CallService) GetCallParticipants(ctx context.Context, callID uuid.UUID) ([]model.CallParticipant, error) {
	return s.repo.GetParticipantsByCallID(ctx, callID)
}
