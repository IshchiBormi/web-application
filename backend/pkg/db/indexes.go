package db

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// EnsureIndexes creates required indexes on boot (idempotent).
func EnsureIndexes(ctx context.Context, db *mongo.Database) error {
	type spec struct {
		coll string
		idx  mongo.IndexModel
	}
	specs := []spec{
		{"users", mongo.IndexModel{Keys: bson.D{{Key: "telegramId", Value: 1}}, Options: options.Index().SetUnique(true).SetSparse(true)}},
		{"users", mongo.IndexModel{Keys: bson.D{{Key: "phone", Value: 1}}, Options: options.Index().SetUnique(true).SetSparse(true)}},
		{"users", mongo.IndexModel{Keys: bson.D{{Key: "firstName", Value: 1}, {Key: "lastName", Value: 1}}}},

		{"elons", mongo.IndexModel{Keys: bson.D{{Key: "status", Value: 1}, {Key: "publishedAt", Value: -1}}}},
		{"elons", mongo.IndexModel{Keys: bson.D{{Key: "ownerId", Value: 1}, {Key: "status", Value: 1}}}},
		{"elons", mongo.IndexModel{Keys: bson.D{{Key: "categoryId", Value: 1}}}},
		{"elons", mongo.IndexModel{Keys: bson.D{{Key: "title", Value: "text"}, {Key: "description", Value: "text"}}}},

		{"applications", mongo.IndexModel{Keys: bson.D{{Key: "workerId", Value: 1}, {Key: "status", Value: 1}}}},
		{"applications", mongo.IndexModel{Keys: bson.D{{Key: "elonId", Value: 1}, {Key: "status", Value: 1}}}},
		{"applications", mongo.IndexModel{Keys: bson.D{{Key: "employerId", Value: 1}, {Key: "status", Value: 1}}}},
		{"applications", mongo.IndexModel{Keys: bson.D{{Key: "elonId", Value: 1}, {Key: "workerId", Value: 1}}, Options: options.Index().SetUnique(true)}},

		{"categories", mongo.IndexModel{Keys: bson.D{{Key: "slug", Value: 1}}, Options: options.Index().SetUnique(true)}},

		{"notifications", mongo.IndexModel{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}}}},
		{"reports", mongo.IndexModel{Keys: bson.D{{Key: "status", Value: 1}, {Key: "createdAt", Value: -1}}}},

		{"admins", mongo.IndexModel{Keys: bson.D{{Key: "username", Value: 1}}, Options: options.Index().SetUnique(true)}},

		// OTP collection: TTL on expiresAt
		{"otp_codes", mongo.IndexModel{Keys: bson.D{{Key: "expiresAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)}},
		{"otp_codes", mongo.IndexModel{Keys: bson.D{{Key: "tgToken", Value: 1}}}},
	}
	for _, s := range specs {
		if _, err := db.Collection(s.coll).Indexes().CreateOne(ctx, s.idx); err != nil {
			return err
		}
	}
	return nil
}
