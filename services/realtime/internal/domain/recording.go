package domain

import "time"

type RecordingStatus string

const (
	// RecordingStatusRecording is the in-flight state: an egress job was started
	// (or attempted) and we are waiting for the egress_ended webhook to finalize.
	RecordingStatusRecording RecordingStatus = "recording"
	// RecordingStatusAvailable means the egress finished and the audio object is
	// persisted in object storage, ready to be served on read.
	RecordingStatusAvailable RecordingStatus = "available"
	// RecordingStatusFailed means the egress never started, produced no usable
	// audio, or ended in error. Recording is fail-soft, so this never breaks the
	// interview — it only tells the recruiter/ops that no replay exists.
	RecordingStatusFailed RecordingStatus = "failed"
	// RecordingStatusDeleted means the audio object was deliberately erased — by
	// the retention sweep (storage limitation) or a recruiter erasure request. The
	// row is kept as a tombstone with ObjectKey cleared and DeletedAt/DeletedReason
	// set, so the read path can show "deleted" instead of presigning a dead key.
	RecordingStatusDeleted RecordingStatus = "deleted"
)

// Recording is runtime evidence that a live interview's audio was captured via
// LiveKit Egress into object storage. It is intentionally NOT part of the
// append-only event log: the egress_ended webhook arrives after the session is
// already terminal (completed/failed), which CanApplyEvent rejects, so recording
// state lives in its own mutable row keyed by EgressID.
//
// A single session can own several recordings (1:N): a candidate who drops and
// rejoins re-enters the same room, LiveKit ends the first egress on room-empty
// and a second egress starts on the next media-ready. EgressID is empty when a
// start attempt failed before LiveKit returned an id.
type Recording struct {
	ID           string
	SessionID    string
	EgressID     string
	ObjectKey    string
	Status       RecordingStatus
	Format       string
	Layout       string
	DurationMs   *int
	FailedReason string
	StartedAt    time.Time
	EndedAt      *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
	// DeletedAt and DeletedReason are set once the audio object has been erased
	// (Status becomes RecordingStatusDeleted); ObjectKey is cleared at that point.
	DeletedAt     *time.Time
	DeletedReason string
}
