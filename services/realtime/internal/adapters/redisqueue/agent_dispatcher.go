package redisqueue

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/redis/go-redis/v9"
)

const (
	defaultAgentJoinStreamKey = "prelude:agent-join:stream"
	defaultAgentJoinLockTTL   = 30 * time.Minute
)

type AgentJoinDispatcher struct {
	client    *redis.Client
	streamKey string
	lockTTL   time.Duration
}

type AgentJoinDispatcherConfig struct {
	URL       string
	StreamKey string
	LockTTL   time.Duration
}

func NewAgentJoinDispatcher(ctx context.Context, config AgentJoinDispatcherConfig) (*AgentJoinDispatcher, error) {
	if strings.TrimSpace(config.URL) == "" {
		return nil, fmt.Errorf("redis url is required")
	}

	options, err := redis.ParseURL(config.URL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}

	client := redis.NewClient(options)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	streamKey := strings.TrimSpace(config.StreamKey)
	if streamKey == "" {
		streamKey = defaultAgentJoinStreamKey
	}

	lockTTL := config.LockTTL
	if lockTTL <= 0 {
		lockTTL = defaultAgentJoinLockTTL
	}

	return &AgentJoinDispatcher{
		client:    client,
		streamKey: streamKey,
		lockTTL:   lockTTL,
	}, nil
}

func (d *AgentJoinDispatcher) EnqueueAgentJoin(ctx context.Context, request application.AgentJoinRequest) (application.AgentJoinDispatchResult, error) {
	sessionID := strings.TrimSpace(request.SessionID)
	if sessionID == "" {
		return application.AgentJoinDispatchResult{}, fmt.Errorf("session id is required")
	}

	requestedAt := request.RequestedAt
	if requestedAt.IsZero() {
		requestedAt = time.Now().UTC()
	}

	lockKey := d.lockKey(sessionID)
	locked, err := d.client.SetNX(ctx, lockKey, requestedAt.Format(time.RFC3339Nano), d.lockTTL).Result()
	if err != nil {
		return application.AgentJoinDispatchResult{}, err
	}
	if !locked {
		return application.AgentJoinDispatchResult{Enqueued: false}, nil
	}

	_, err = d.client.XAdd(ctx, &redis.XAddArgs{
		Stream: d.streamKey,
		Values: map[string]any{
			"session_id":   sessionID,
			"candidate_id": strings.TrimSpace(request.CandidateID),
			"requested_at": requestedAt.UTC().Format(time.RFC3339Nano),
		},
	}).Result()
	if err != nil {
		_ = d.client.Del(ctx, lockKey).Err()
		return application.AgentJoinDispatchResult{}, err
	}

	return application.AgentJoinDispatchResult{Enqueued: true}, nil
}

func (d *AgentJoinDispatcher) Close() error {
	return d.client.Close()
}

func (d *AgentJoinDispatcher) lockKey(sessionID string) string {
	return "prelude:agent-join:lock:" + sessionID
}
