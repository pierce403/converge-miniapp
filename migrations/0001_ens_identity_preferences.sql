CREATE TABLE ens_identity_preferences (
  fid INTEGER PRIMARY KEY CHECK (fid > 0),
  choice TEXT NOT NULL CHECK (choice IN ('accepted', 'dismissed')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
