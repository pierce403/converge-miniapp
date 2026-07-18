CREATE TABLE xmtp_notification_routes (
  inbox_handle TEXT PRIMARY KEY
    CHECK (length(inbox_handle) BETWEEN 43 AND 128),
  fid INTEGER NOT NULL UNIQUE CHECK (fid > 0),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'revoking')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE xmtp_notification_deliveries (
  delivery_id TEXT PRIMARY KEY
    CHECK (length(delivery_id) BETWEEN 8 AND 120),
  inbox_handle TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('processing', 'retry', 'delivered')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  lease_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (inbox_handle)
    REFERENCES xmtp_notification_routes(inbox_handle)
    ON DELETE CASCADE
);

CREATE INDEX xmtp_notification_deliveries_route_idx
  ON xmtp_notification_deliveries(inbox_handle, updated_at);

CREATE INDEX xmtp_notification_deliveries_retention_idx
  ON xmtp_notification_deliveries(status, updated_at);
