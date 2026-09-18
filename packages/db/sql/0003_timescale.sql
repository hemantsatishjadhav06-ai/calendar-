-- Hypertables and continuous aggregates. Idempotent.
SELECT create_hypertable('"ChannelMetricDaily"', 'day', chunk_time_interval => INTERVAL '30 days', migrate_data => true, if_not_exists => true);
SELECT create_hypertable('"PostMetric"', 'capturedAt', chunk_time_interval => INTERVAL '7 days', migrate_data => true, if_not_exists => true);

CREATE TABLE IF NOT EXISTS short_link_clicks (
  ts timestamptz NOT NULL, short_link_id uuid NOT NULL, organization_id uuid NOT NULL,
  country text, referrer text, ua_family text, ip_hash text);
SELECT create_hypertable('short_link_clicks', 'ts', if_not_exists => true);
CREATE INDEX IF NOT EXISTS short_link_clicks_link_idx ON short_link_clicks (short_link_id, ts DESC);

CREATE TABLE IF NOT EXISTS start_page_events (
  ts timestamptz NOT NULL, start_page_id uuid NOT NULL, organization_id uuid NOT NULL,
  event text NOT NULL, block_id text, referrer text, country text);
SELECT create_hypertable('start_page_events', 'ts', if_not_exists => true);

-- Latest value per post metric per day
CREATE MATERIALIZED VIEW IF NOT EXISTS post_metric_latest WITH (timescaledb.continuous) AS
SELECT "postTargetId", metric, time_bucket('1 day', "capturedAt") AS day, last(value, "capturedAt") AS value
FROM "PostMetric" GROUP BY 1, 2, 3
WITH NO DATA;
SELECT add_continuous_aggregate_policy('post_metric_latest', start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour', if_not_exists => true);

-- Current (most recent) value per post metric — used by Insights tables
CREATE OR REPLACE VIEW post_metric_current AS
SELECT DISTINCT ON ("postTargetId", metric) "postTargetId", metric, value, "capturedAt"
FROM "PostMetric" ORDER BY "postTargetId", metric, "capturedAt" DESC;

ALTER TABLE "PostMetric" SET (timescaledb.compress, timescaledb.compress_segmentby = '"postTargetId"');
SELECT add_compression_policy('"PostMetric"', INTERVAL '90 days', if_not_exists => true);
SELECT add_retention_policy('short_link_clicks', INTERVAL '3 years', if_not_exists => true);
SELECT add_retention_policy('start_page_events', INTERVAL '3 years', if_not_exists => true);

-- Full text / trigram search
CREATE INDEX IF NOT EXISTS post_target_text_trgm ON "PostTarget" USING gin (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idea_body_trgm ON "Idea" USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS comment_text_trgm ON "Comment" USING gin (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS comment_embedding_idx ON "Comment" USING hnsw (embedding vector_cosine_ops);
