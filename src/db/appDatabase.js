const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

/**
 * SQLite-backed application database wrapper.
 */
class AppDatabase {
  /**
   * @param {string} filename SQLite filename or `:memory:`.
   */
  constructor(filename) {
    this.filename = filename;
    this.ensureDirectory();
    this.db = new DatabaseSync(filename);
    this.initializeSchema();
  }

  /**
   * Ensure the database directory exists for file-backed databases.
   *
   * @returns {void}
   */
  ensureDirectory() {
    if (this.filename === ':memory:') {
      return;
    }

    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
  }

  /**
   * Initialize all application tables and indexes.
   *
   * @returns {void}
   */
  initializeSchema() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS creators (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS creator_settings (
        creator_id TEXT PRIMARY KEY REFERENCES creators(id),
        flow_rate TEXT NOT NULL,
        currency TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL REFERENCES creators(id),
        title TEXT,
        visibility TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS coop_splits (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL REFERENCES creators(id),
        split_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS creator_audit_logs (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL REFERENCES creators(id),
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_creator_audit_logs_creator_timestamp
      ON creator_audit_logs (creator_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        user_address TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments (post_id);
      CREATE INDEX IF NOT EXISTS idx_comments_creator_id ON comments (creator_id);
      CREATE INDEX IF NOT EXISTS idx_comments_user_address ON comments (user_address);

      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id TEXT PRIMARY KEY,
        user_address TEXT NOT NULL,
        creator_address TEXT NOT NULL,
        content_id TEXT NOT NULL,
        is_authorized INTEGER NOT NULL DEFAULT 0,
        subscription_type TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_synced_block INTEGER,
        metadata_json TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_unique 
      ON user_subscriptions (user_address, creator_address, content_id);
      CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions (user_address);
      CREATE INDEX IF NOT EXISTS idx_user_subscriptions_creator ON user_subscriptions (creator_address);
      CREATE INDEX IF NOT EXISTS idx_user_subscriptions_authorized ON user_subscriptions (is_authorized);
    `);
  }

  /**
   * Execute work inside a database transaction.
   *
   * @template T
   * @param {() => T} callback Work to execute.
   * @returns {T}
   */
  transaction(callback) {
    this.db.exec('BEGIN');

    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Ensure a creator row exists.
   *
   * @param {string} creatorId Creator identifier.
   * @returns {void}
   */
  ensureCreator(creatorId) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO creators (id, created_at)
        VALUES (?, ?)
        ON CONFLICT(id) DO NOTHING
      `,
      )
      .run(creatorId, now);
  }

  /**
   * Seed a video for tests or local setup.
   *
   * @param {{id: string, creatorId: string, title?: string, visibility: string}} video Video seed.
   * @returns {void}
   */
  seedVideo(video) {
    this.ensureCreator(video.creatorId);
    this.db
      .prepare(
        `
        INSERT INTO videos (id, creator_id, title, visibility, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(
        video.id,
        video.creatorId,
        video.title || null,
        video.visibility,
        new Date().toISOString(),
      );
  }

  /**
   * Seed a co-op split for tests or local setup.
   *
   * @param {{id: string, creatorId: string, splits: object[]}} split Co-op split seed.
   * @returns {void}
   */
  seedCoopSplit(split) {
    this.ensureCreator(split.creatorId);
    this.db
      .prepare(
        `
        INSERT INTO coop_splits (id, creator_id, split_json, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(split.id, split.creatorId, JSON.stringify(split.splits), new Date().toISOString());
  }

  /**
   * Seed creator settings for tests or local setup.
   *
   * @param {{creatorId: string, flowRate: string, currency?: string}} settings Settings seed.
   * @returns {void}
   */
  seedCreatorSettings(settings) {
    this.ensureCreator(settings.creatorId);
    this.db
      .prepare(
        `
        INSERT INTO creator_settings (creator_id, flow_rate, currency, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(creator_id) DO UPDATE SET
          flow_rate = excluded.flow_rate,
          currency = excluded.currency,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        settings.creatorId,
        settings.flowRate,
        settings.currency || null,
        new Date().toISOString(),
      );
  }

  /**
   * Get creator settings for a creator.
   *
   * @param {string} creatorId Creator identifier.
   * @returns {object|null}
   */
  getCreatorSettings(creatorId) {
    const row = this.db
      .prepare(
        `
        SELECT creator_id AS creatorId, flow_rate AS flowRate, currency, updated_at AS updatedAt
        FROM creator_settings
        WHERE creator_id = ?
      `,
      )
      .get(creatorId);

    return row || null;
  }

  /**
   * Create or update creator settings.
   *
   * @param {{creatorId: string, flowRate: string, currency: string|null, updatedAt: string}} settings Settings data.
   * @returns {object}
   */
  upsertCreatorSettings(settings) {
    this.ensureCreator(settings.creatorId);
    this.db
      .prepare(
        `
        INSERT INTO creator_settings (creator_id, flow_rate, currency, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(creator_id) DO UPDATE SET
          flow_rate = excluded.flow_rate,
          currency = excluded.currency,
          updated_at = excluded.updated_at
      `,
      )
      .run(settings.creatorId, settings.flowRate, settings.currency, settings.updatedAt);

    return this.getCreatorSettings(settings.creatorId);
  }

  /**
   * Fetch a video.
   *
   * @param {string} videoId Video identifier.
   * @returns {object|null}
   */
  getVideoById(videoId) {
    const row = this.db
      .prepare(
        `
        SELECT id, creator_id AS creatorId, title, visibility, updated_at AS updatedAt
        FROM videos
        WHERE id = ?
      `,
      )
      .get(videoId);

    return row || null;
  }

  /**
   * Update the visibility of an existing video.
   *
   * @param {{videoId: string, visibility: string, updatedAt: string}} input Update payload.
   * @returns {object}
   */
  updateVideoVisibility(input) {
    this.db
      .prepare(
        `
        UPDATE videos
        SET visibility = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(input.visibility, input.updatedAt, input.videoId);

    return this.getVideoById(input.videoId);
  }

  /**
   * Fetch a co-op split by identifier.
   *
   * @param {string} splitId Split identifier.
   * @returns {object|null}
   */
  getCoopSplitById(splitId) {
    const row = this.db
      .prepare(
        `
        SELECT id, creator_id AS creatorId, split_json AS splitJson, updated_at AS updatedAt
        FROM coop_splits
        WHERE id = ?
      `,
      )
      .get(splitId);

    if (!row) {
      return null;
    }

    return {
      ...row,
      splits: JSON.parse(row.splitJson),
    };
  }

  /**
   * Update an existing co-op split.
   *
   * @param {{splitId: string, splits: object[], updatedAt: string}} input Update payload.
   * @returns {object}
   */
  updateCoopSplit(input) {
    this.db
      .prepare(
        `
        UPDATE coop_splits
        SET split_json = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(JSON.stringify(input.splits), input.updatedAt, input.splitId);

    return this.getCoopSplitById(input.splitId);
  }

  /**
   * Insert an immutable audit log entry.
   *
   * @param {{creatorId: string, actionType: string, entityType: string, entityId: string, timestamp: string, ipAddress: string, metadata: object}} entry Audit log payload.
   * @returns {object}
   */
  insertAuditLog(entry) {
    const id = crypto.randomUUID();
    this.ensureCreator(entry.creatorId);
    this.db
      .prepare(
        `
        INSERT INTO creator_audit_logs (
          id,
          creator_id,
          action_type,
          entity_type,
          entity_id,
          timestamp,
          ip_address,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        entry.creatorId,
        entry.actionType,
        entry.entityType,
        entry.entityId,
        entry.timestamp,
        entry.ipAddress,
        JSON.stringify(entry.metadata || {}),
        entry.timestamp,
      );

    return this.db
      .prepare(
        `
        SELECT
          id,
          creator_id AS creatorId,
          action_type AS actionType,
          entity_type AS entityType,
          entity_id AS entityId,
          timestamp,
          ip_address AS ipAddress,
          metadata_json AS metadataJson,
          created_at AS createdAt
        FROM creator_audit_logs
        WHERE id = ?
      `,
      )
      .get(id);
  }

  /**
   * List audit logs for a creator in reverse chronological order.
   *
   * @param {string} creatorId Creator identifier.
   * @returns {object[]}
   */
  listAuditLogsByCreatorId(creatorId) {
    return this.db
      .prepare(
        `
        SELECT
          id,
          creator_id AS creatorId,
          action_type AS actionType,
          entity_type AS entityType,
          entity_id AS entityId,
          timestamp,
          ip_address AS ipAddress,
          metadata_json AS metadataJson,
          created_at AS createdAt
        FROM creator_audit_logs
        WHERE creator_id = ?
        ORDER BY timestamp DESC, id DESC
      `,
      )
      .all(creatorId);
  }

  /**
   * Create a new comment.
   *
   * @param {{postId: string, userAddress: string, creatorId: string, content: string}} comment Comment data.
   * @returns {object}
   */
  createComment(comment) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO comments (id, post_id, user_address, creator_id, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(id, comment.postId, comment.userAddress, comment.creatorId, comment.content, now, now);

    return this.getCommentById(id);
  }

  /**
   * Get a comment by ID.
   *
   * @param {string} commentId Comment identifier.
   * @returns {object|null}
   */
  getCommentById(commentId) {
    const row = this.db
      .prepare(
        `
        SELECT id, post_id AS postId, user_address AS userAddress, creator_id AS creatorId, content, created_at AS createdAt, updated_at AS updatedAt
        FROM comments
        WHERE id = ?
      `,
      )
      .get(commentId);

    return row || null;
  }

  /**
   * Get comments by post ID.
   *
   * @param {string} postId Post identifier.
   * @returns {object[]}
   */
  getCommentsByPostId(postId) {
    return this.db
      .prepare(
        `
        SELECT id, post_id AS postId, user_address AS userAddress, creator_id AS creatorId, content, created_at AS createdAt, updated_at AS updatedAt
        FROM comments
        WHERE post_id = ?
        ORDER BY created_at DESC
      `,
      )
      .all(postId);
  }

  /**
   * Update a comment.
   *
   * @param {{commentId: string, content: string}} input Update payload.
   * @returns {object}
   */
  updateComment(input) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE comments
        SET content = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(input.content, now, input.commentId);

    return this.getCommentById(input.commentId);
  }

  /**
   * Delete a comment.
   *
   * @param {string} commentId Comment identifier.
   * @returns {boolean}
   */
  deleteComment(commentId) {
    const result = this.db
      .prepare(
        `
        DELETE FROM comments WHERE id = ?
      `,
      )
      .run(commentId);

    return result.changes > 0;
  }

  /**
   * Insert or update a user subscription record.
   *
   * @param {{userAddress: string, creatorAddress: string, contentId: string, isAuthorized: boolean, subscriptionType?: string, startedAt?: string, endedAt?: string, lastSyncedBlock?: number, metadata?: object}} subscription Subscription data.
   * @returns {object}
   */
  upsertUserSubscription(subscription) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    this.db
      .prepare(
        `
        INSERT INTO user_subscriptions (
          id,
          user_address,
          creator_address,
          content_id,
          is_authorized,
          subscription_type,
          started_at,
          ended_at,
          created_at,
          updated_at,
          last_synced_block,
          metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_address, creator_address, content_id) DO UPDATE SET
          is_authorized = excluded.is_authorized,
          subscription_type = excluded.subscription_type,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          updated_at = excluded.updated_at,
          last_synced_block = excluded.last_synced_block,
          metadata_json = excluded.metadata_json
      `,
      )
      .run(
        id,
        subscription.userAddress,
        subscription.creatorAddress,
        subscription.contentId,
        subscription.isAuthorized ? 1 : 0,
        subscription.subscriptionType || null,
        subscription.startedAt || null,
        subscription.endedAt || null,
        now,
        now,
        subscription.lastSyncedBlock || null,
        subscription.metadata ? JSON.stringify(subscription.metadata) : null,
      );

    return this.getUserSubscription(subscription.userAddress, subscription.creatorAddress, subscription.contentId);
  }

  /**
   * Get a user subscription by addresses and content ID.
   *
   * @param {string} userAddress User wallet address.
   * @param {string} creatorAddress Creator wallet address.
   * @param {string} contentId Content identifier.
   * @returns {object|null}
   */
  getUserSubscription(userAddress, creatorAddress, contentId) {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          user_address AS userAddress,
          creator_address AS creatorAddress,
          content_id AS contentId,
          is_authorized AS isAuthorized,
          subscription_type AS subscriptionType,
          started_at AS startedAt,
          ended_at AS endedAt,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_synced_block AS lastSyncedBlock,
          metadata_json AS metadataJson
        FROM user_subscriptions
        WHERE user_address = ? AND creator_address = ? AND content_id = ?
      `,
      )
      .get(userAddress, creatorAddress, contentId);

    if (!row) {
      return null;
    }

    return {
      ...row,
      isAuthorized: row.isAuthorized === 1,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
    };
  }

  /**
   * Update user authorization status.
   *
   * @param {string} userAddress User wallet address.
   * @param {string} creatorAddress Creator wallet address.
   * @param {string} contentId Content identifier.
   * @param {boolean} isAuthorized Authorization status.
   * @param {object} [metadata] Optional metadata to update.
   * @returns {object|null}
   */
  updateUserAuthorization(userAddress, creatorAddress, contentId, isAuthorized, metadata = null) {
    const now = new Date().toISOString();
    
    this.db
      .prepare(
        `
        UPDATE user_subscriptions
        SET is_authorized = ?, updated_at = ?, metadata_json = ?
        WHERE user_address = ? AND creator_address = ? AND content_id = ?
      `,
      )
      .run(isAuthorized ? 1 : 0, now, metadata ? JSON.stringify(metadata) : null, userAddress, creatorAddress, contentId);

    return this.getUserSubscription(userAddress, creatorAddress, contentId);
  }

  /**
   * Get all active subscriptions for a user.
   *
   * @param {string} userAddress User wallet address.
   * @returns {object[]}
   */
  getActiveSubscriptionsForUser(userAddress) {
    return this.db
      .prepare(
        `
        SELECT
          id,
          user_address AS userAddress,
          creator_address AS creatorAddress,
          content_id AS contentId,
          is_authorized AS isAuthorized,
          subscription_type AS subscriptionType,
          started_at AS startedAt,
          ended_at AS endedAt,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_synced_block AS lastSyncedBlock,
          metadata_json AS metadataJson
        FROM user_subscriptions
        WHERE user_address = ? AND is_authorized = 1
        ORDER BY updated_at DESC
      `,
      )
      .all(userAddress)
      .map(row => ({
        ...row,
        isAuthorized: row.isAuthorized === 1,
        metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
      }));
  }

  /**
   * Get all subscribers for a creator.
   *
   * @param {string} creatorAddress Creator wallet address.
   * @param {string} [contentId] Optional content ID filter.
   * @returns {object[]}
   */
  getSubscribersForCreator(creatorAddress, contentId = null) {
    const query = contentId
      ? `
        SELECT
          id,
          user_address AS userAddress,
          creator_address AS creatorAddress,
          content_id AS contentId,
          is_authorized AS isAuthorized,
          subscription_type AS subscriptionType,
          started_at AS startedAt,
          ended_at AS endedAt,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_synced_block AS lastSyncedBlock,
          metadata_json AS metadataJson
        FROM user_subscriptions
        WHERE creator_address = ? AND content_id = ? AND is_authorized = 1
        ORDER BY started_at DESC
      `
      : `
        SELECT
          id,
          user_address AS userAddress,
          creator_address AS creatorAddress,
          content_id AS contentId,
          is_authorized AS isAuthorized,
          subscription_type AS subscriptionType,
          started_at AS startedAt,
          ended_at AS endedAt,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_synced_block AS lastSyncedBlock,
          metadata_json AS metadataJson
        FROM user_subscriptions
        WHERE creator_address = ? AND is_authorized = 1
        ORDER BY started_at DESC
      `;

    return this.db
      .prepare(query)
      .all(contentId ? [creatorAddress, contentId] : [creatorAddress])
      .map(row => ({
        ...row,
        isAuthorized: row.isAuthorized === 1,
        metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
      }));
  }
}

module.exports = {
  AppDatabase,
};
