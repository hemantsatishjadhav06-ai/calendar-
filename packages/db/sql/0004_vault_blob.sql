-- Opaque encrypted blobs (Bluesky OAuth sessions, integration credentials). Vault role only.
CREATE TABLE IF NOT EXISTS "VaultBlob" (
  key text PRIMARY KEY,
  value_enc bytea NOT NULL,
  dek_enc bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON "VaultBlob" FROM relay;
GRANT SELECT, INSERT, UPDATE, DELETE ON "VaultBlob" TO relay_vault;
