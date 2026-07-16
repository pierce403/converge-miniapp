CREATE TABLE farcaster_notification_subscriptions (
  fid INTEGER NOT NULL CHECK (fid > 0),
  app_fid INTEGER NOT NULL CHECK (app_fid > 0),
  details_ciphertext TEXT NOT NULL,
  details_nonce TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (fid, app_fid)
);
