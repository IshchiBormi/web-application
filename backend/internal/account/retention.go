package account

import (
	"context"
	"log/slog"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Retention: deleting an account is a two-stage process.
//
// Stage 1 (immediate, see softDelete): the account is flagged isDeleted, its
// identity is released (phone/telegramId unset and archived to deleted*), its
// listings leave the feed and its in-flight applications are cancelled. From
// this moment the account is unreachable — every API call with its old token is
// rejected with 403 account_disabled and no other user can see it.
//
// Stage 2 (this file, after RetentionDays): everything is destroyed for good.
// The user document, their listings, applications, notifications, reports,
// feedback, one-time codes and uploaded files are hard-deleted from MongoDB and
// object storage, including the archived deletedPhone/deletedTelegramId. After
// stage 2 nothing linking back to the person remains.
//
// The window exists so a user who deleted by mistake (or under a hijacked
// session) can contact support and be told what happened, and so fraud/abuse
// reports filed just before the deletion can still be acted on. Google Play's
// account-deletion policy allows exactly this kind of bounded grace period as
// long as it is disclosed — it is, on /delete-account and in the privacy policy.

const (
	// DefaultRetentionDays is the grace period between soft delete and
	// permanent erasure. Must match what /delete-account and the privacy
	// policy tell users (90 days).
	DefaultRetentionDays = 90

	// purgeTick — how often expired accounts are swept. The deadline is a
	// 90-day one, so hourly precision is pointless; 6h keeps the load
	// negligible while still purging promptly after a restart.
	purgeTick = 6 * time.Hour

	// purgeBatch bounds one sweep so a large backlog (e.g. the first run after
	// this feature ships) is drained over several ticks instead of holding a
	// cursor open across thousands of multi-collection deletes.
	purgeBatch = 200
)

// Purger permanently erases accounts whose retention window has expired.
type Purger struct {
	users    *mongo.Collection
	elons    *mongo.Collection
	apps     *mongo.Collection
	notifs   *mongo.Collection
	reports  *mongo.Collection
	feedback *mongo.Collection
	codes    *mongo.Collection
	otps     *mongo.Collection
	// botFeedback is written by a *different process* — cmd/feedbackbot in the
	// bot module — into the same database. It holds phone, name, Telegram
	// username and the text/voice/photo the user sent to the support bot. It
	// has no userId, so it is matched by the archived identity instead (see
	// purgeBotFeedback). Missing this collection is what made the "nothing
	// remains after 90 days" promise false.
	botFeedback *mongo.Collection
	storage     *storage.Service
	// retention is the full grace period; an account is erased once
	// deletedAt is older than this.
	retention time.Duration
	log       *slog.Logger
}

// NewPurger builds the sweeper. retentionDays <= 0 falls back to
// DefaultRetentionDays: a typo in the environment must never silently turn
// permanent deletion off (or, worse, erase accounts immediately).
func NewPurger(db *mongo.Database, s *storage.Service, retentionDays int, log *slog.Logger) *Purger {
	if retentionDays <= 0 {
		retentionDays = DefaultRetentionDays
	}
	return &Purger{
		users:       db.Collection("users"),
		elons:       db.Collection("elons"),
		apps:        db.Collection("applications"),
		notifs:      db.Collection("notifications"),
		reports:     db.Collection("reports"),
		feedback:    db.Collection("feedback"),
		codes:       db.Collection("delete_codes"),
		otps:        db.Collection("otp_codes"),
		botFeedback: db.Collection("bot_feedback"),
		storage:     s,
		retention:   time.Duration(retentionDays) * 24 * time.Hour,
		log:         log,
	}
}

// RetentionDays is what the purger actually enforces — the public pages read it
// from here so the number users are shown can never drift from the number the
// code applies.
func (p *Purger) RetentionDays() int { return int(p.retention / (24 * time.Hour)) }

// Run sweeps expired accounts on a ticker until ctx is cancelled. Started as a
// single background goroutine from main, alongside the other schedulers.
func (p *Purger) Run(ctx context.Context) {
	t := time.NewTicker(purgeTick)
	defer t.Stop()
	p.PurgeDue(ctx) // don't wait a full tick after a deploy
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.PurgeDue(ctx)
		}
	}
}

// PurgeDue erases every account whose retention window closed, up to
// purgeBatch of them. Returns how many were fully erased.
//
// Covers both deletion paths: self-service (account.softDelete) and admin
// removal (admin.DeleteUser) both stamp deletedAt, so both are on the same
// clock and neither can leave a record behind forever.
func (p *Purger) PurgeDue(ctx context.Context) int {
	cutoff := time.Now().Add(-p.retention)
	cur, err := p.users.Find(ctx,
		bson.M{"isDeleted": true, "deletedAt": bson.M{"$lte": cutoff}},
		options.Find().SetLimit(purgeBatch),
	)
	if err != nil {
		p.log.Warn("retention: find expired accounts", "err", err)
		return 0
	}
	var expired []models.User
	for cur.Next(ctx) {
		var u models.User
		if cur.Decode(&u) == nil {
			expired = append(expired, u)
		}
	}
	_ = cur.Close(ctx)

	done := 0
	for _, u := range expired {
		if err := p.purgeUser(ctx, u); err != nil {
			// Leave the record in place: the user document is deleted last, so
			// a failed pass simply retries on the next tick.
			p.log.Warn("retention: purge failed", "userId", u.ID.Hex(), "err", err)
			continue
		}
		done++
	}
	if done > 0 {
		p.log.Info("retention: accounts permanently deleted", "count", done, "retentionDays", p.RetentionDays())
	}
	return done
}

// purgeUser destroys one expired account and everything personal attached to it.
//
// Order is deliberate: files first, then the documents that reference the user,
// and the user document itself last. Deleting the user last makes the whole
// operation safely retryable — if the process dies halfway, the account is
// still flagged expired and the next sweep finishes the job. Doing it the other
// way round would orphan the remaining records with no way to find them again.
func (p *Purger) purgeUser(ctx context.Context, u models.User) error {
	uid := u.ID

	// --- Uploaded files -----------------------------------------------------
	// softDelete already fired these off best-effort at deletion time; repeating
	// it here is the guarantee, since that call was detached and unchecked.
	// Deleting an already-deleted object is a no-op on both S3 and local disk.
	upload.DeleteByURL(p.storage, u.AvatarURL)

	elonIDs := make([]primitive.ObjectID, 0, 8)
	if cur, err := p.elons.Find(ctx, bson.M{"ownerId": uid}); err == nil {
		for cur.Next(ctx) {
			var e models.Elon
			if cur.Decode(&e) != nil {
				continue
			}
			elonIDs = append(elonIDs, e.ID)
			for _, img := range e.Images {
				upload.DeleteByURL(p.storage, img)
			}
		}
		_ = cur.Close(ctx)
	}

	// --- Reports ------------------------------------------------------------
	// Both directions: reports this user filed, reports filed against them, and
	// reports filed against their listings. All three name the person.
	reportFilter := bson.M{"$or": []bson.M{
		{"reporterId": uid},
		{"targetType": "user", "targetId": uid},
	}}
	if len(elonIDs) > 0 {
		reportFilter["$or"] = append(reportFilter["$or"].([]bson.M),
			bson.M{"targetType": "elon", "targetId": bson.M{"$in": elonIDs}})
	}
	if _, err := p.reports.DeleteMany(ctx, reportFilter); err != nil {
		return err
	}

	// --- Applications -------------------------------------------------------
	// Every application document carries denormalized personal data (worker
	// phone, both parties' names, avatars) — there is no subset that can be
	// kept without keeping the deleted person's identity, so both sides go.
	// Applications to this user's listings are included via elonId, in case an
	// employerId was ever missing.
	appFilter := bson.M{"$or": []bson.M{{"workerId": uid}, {"employerId": uid}}}
	if len(elonIDs) > 0 {
		appFilter["$or"] = append(appFilter["$or"].([]bson.M),
			bson.M{"elonId": bson.M{"$in": elonIDs}})
	}
	// Collect the ids first: the counterparty keeps notifications that deep-link
	// to these applications, and once the applications are gone those links
	// resolve to nothing. Gather them before deleting so the notifications can
	// be cleaned up too (below).
	appIDs := make([]primitive.ObjectID, 0, 8)
	if cur, err := p.apps.Find(ctx, appFilter,
		options.Find().SetProjection(bson.M{"_id": 1})); err == nil {
		for cur.Next(ctx) {
			var a struct {
				ID primitive.ObjectID `bson:"_id"`
			}
			if cur.Decode(&a) == nil {
				appIDs = append(appIDs, a.ID)
			}
		}
		_ = cur.Close(ctx)
	}
	if _, err := p.apps.DeleteMany(ctx, appFilter); err != nil {
		return err
	}

	// --- Listings, notifications, feedback, one-time codes -------------------
	if _, err := p.elons.DeleteMany(ctx, bson.M{"ownerId": uid}); err != nil {
		return err
	}
	if _, err := p.notifs.DeleteMany(ctx, bson.M{"userId": uid}); err != nil {
		return err
	}
	// Counterparties' notifications pointing at the applications just deleted.
	// These belong to other users and carry no personal data of the deleted
	// person (bodies quote the listing title, never a name), but they deep-link
	// into records that no longer exist, so tapping one leads nowhere. Removing
	// them keeps the other side's inbox honest.
	if len(appIDs) > 0 {
		if _, err := p.notifs.DeleteMany(ctx, bson.M{
			"relatedEntity.type": "application",
			"relatedEntity.id":   bson.M{"$in": appIDs},
		}); err != nil {
			return err
		}
	}
	if _, err := p.feedback.DeleteMany(ctx, bson.M{"userId": uid}); err != nil {
		return err
	}
	if _, err := p.codes.DeleteMany(ctx, bson.M{"userId": uid}); err != nil {
		return err
	}
	// Login OTPs are keyed by phone/telegramId, not userId, and the live values
	// were moved to deleted* when the identity was released. A TTL index reaps
	// these within minutes anyway; this is the belt to that suspenders.
	otpOr := []bson.M{}
	if u.DeletedPhone != "" {
		otpOr = append(otpOr, bson.M{"phone": u.DeletedPhone})
	}
	if u.DeletedTelegramID != 0 {
		otpOr = append(otpOr, bson.M{"telegramId": u.DeletedTelegramID})
	}
	if len(otpOr) > 0 {
		if _, err := p.otps.DeleteMany(ctx, bson.M{"$or": otpOr}); err != nil {
			return err
		}
	}

	// --- Support-bot conversations ------------------------------------------
	if err := p.purgeBotFeedback(ctx, u); err != nil {
		return err
	}

	// --- The account itself -------------------------------------------------
	// Hard delete, not another flag: this removes the name, bio, skills,
	// region, avatar URL, ratings and the archived deletedPhone /
	// deletedTelegramId in one shot.
	if _, err := p.users.DeleteOne(ctx, bson.M{"_id": uid}); err != nil {
		return err
	}
	return nil
}

// purgeBotFeedback deletes the support-bot conversations belonging to an expired
// account: the suggestion/complaint records in bot_feedback, each carrying the
// sender's phone, name, Telegram username and their message — text, or a file id
// for a voice note or photo.
//
// Matching is by archived identity, not userId: cmd/feedbackbot lives in a
// separate module, writes these documents itself, and only ever knows the person
// as a Telegram id + phone number. softDelete moves exactly those two values to
// deletedTelegramId / deletedPhone, which is what makes the join possible at
// all after the identity has been released.
//
// The createdAt bound is essential. A released phone number can be registered
// again the next day, and the returning person is a *different account* that may
// have written to the support bot in the meantime. Without the bound, purging
// the old account 90 days later would delete the new account's messages too.
// Restricting to records written before the account was deleted keeps each
// incarnation's history with the incarnation that produced it.
//
// LIMITATION, disclosed on both privacy pages: voice notes and photos are not
// stored by us. bot_feedback keeps only Telegram's file id, and the media itself
// lives on Telegram's servers under Telegram's own retention. Deleting these
// documents destroys our ability to reference that media, but cannot reach into
// Telegram to erase it — no Bot API method exists for that. The same is true of
// the chat transcript in the user's own Telegram client.
func (p *Purger) purgeBotFeedback(ctx context.Context, u models.User) error {
	// deletedAt is always set by softDelete/admin.DeleteUser on the records this
	// sweep selects; the fallback keeps a hand-edited document from widening the
	// filter to "all time".
	cutoff := time.Now()
	if u.DeletedAt != nil {
		cutoff = *u.DeletedAt
	}

	identity := []bson.M{}
	if u.DeletedTelegramID != 0 {
		identity = append(identity, bson.M{"telegramId": u.DeletedTelegramID})
	}
	if u.DeletedPhone != "" {
		identity = append(identity, bson.M{"phone": u.DeletedPhone})
	}
	if len(identity) == 0 {
		// Nothing to match on: the account never had a phone or Telegram id
		// bound, so it cannot have reached the support bot either.
		return nil
	}

	_, err := p.botFeedback.DeleteMany(ctx, bson.M{
		"$or":       identity,
		"createdAt": bson.M{"$lte": cutoff},
	})
	return err
}
