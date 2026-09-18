-- Three database roles: app (RLS-enforced), admin (bypass RLS: dispatcher/collectors/migrations), vault (only role that can read credentials)
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- uuid v7 (time-ordered) generator
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea; uuid_bytes bytea;
BEGIN
  unix_ts_ms = substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes = unix_ts_ms || gen_random_bytes(10);
  uuid_bytes = set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  uuid_bytes = set_byte(uuid_bytes, 8, (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$ LANGUAGE plpgsql VOLATILE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'relay') THEN CREATE ROLE relay LOGIN PASSWORD 'relay'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'relay_vault') THEN CREATE ROLE relay_vault LOGIN PASSWORD 'relay' BYPASSRLS; END IF;
END $$;
GRANT CONNECT ON DATABASE relay TO relay, relay_vault;
GRANT USAGE ON SCHEMA public TO relay, relay_vault;
ALTER DEFAULT PRIVILEGES FOR ROLE relay_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO relay;
ALTER DEFAULT PRIVILEGES FOR ROLE relay_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO relay;
ALTER DEFAULT PRIVILEGES FOR ROLE relay_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO relay_vault;
