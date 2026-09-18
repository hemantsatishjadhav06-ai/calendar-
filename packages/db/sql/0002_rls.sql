-- Row-Level Security: every tenant-owned table is isolated by organization_id = current_setting('app.org_id').
-- Applied after `prisma migrate deploy` by scripts/apply-sql.ts (idempotent).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'Organization','Membership','Channel','ChannelGroup','Post','PostTarget','Note','Tag','HashtagGroup','Template',
    'IdeaGroup','Idea','Asset','ShortLink','Report','Comment','SavedReply','SavedView','StartPage','Subscription','ApiKey','OAuthClient',
    'Integration','FeatureFlag','AuditLog','AiUsage','SpendLedger'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    IF t = 'Organization' THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (id = current_setting('app.org_id', true)::uuid) WITH CHECK (id = current_setting('app.org_id', true)::uuid)$p$, t);
    ELSE
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting('app.org_id', true)::uuid) WITH CHECK ("organizationId" = current_setting('app.org_id', true)::uuid)$p$, t);
    END IF;
  END LOOP;
END $$;

-- Tables keyed indirectly (through channel/post) get policies via joins
ALTER TABLE "PostingSlot" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PostingSlot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PostingSlot";
CREATE POLICY tenant_isolation ON "PostingSlot" USING (EXISTS (SELECT 1 FROM "Channel" c WHERE c.id = "channelId" AND c."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "ChannelGrant" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ChannelGrant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChannelGrant";
CREATE POLICY tenant_isolation ON "ChannelGrant" USING (EXISTS (SELECT 1 FROM "Channel" c WHERE c.id = "channelId" AND c."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "ChannelGroupMember" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ChannelGroupMember" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChannelGroupMember";
CREATE POLICY tenant_isolation ON "ChannelGroupMember" USING (EXISTS (SELECT 1 FROM "Channel" c WHERE c.id = "channelId" AND c."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "PostTag" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PostTag" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PostTag";
CREATE POLICY tenant_isolation ON "PostTag" USING (EXISTS (SELECT 1 FROM "Post" p WHERE p.id = "postId" AND p."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "IdeaTag" ENABLE ROW LEVEL SECURITY; ALTER TABLE "IdeaTag" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IdeaTag";
CREATE POLICY tenant_isolation ON "IdeaTag" USING (EXISTS (SELECT 1 FROM "Idea" i WHERE i.id = "ideaId" AND i."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "Approval" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Approval" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Approval";
CREATE POLICY tenant_isolation ON "Approval" USING (EXISTS (SELECT 1 FROM "Post" p WHERE p.id = "postId" AND p."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "NotificationJob" ENABLE ROW LEVEL SECURITY; ALTER TABLE "NotificationJob" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificationJob";
CREATE POLICY tenant_isolation ON "NotificationJob" USING (EXISTS (SELECT 1 FROM "PostTarget" t WHERE t.id = "postTargetId" AND t."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "ChannelMetricDaily" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ChannelMetricDaily" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChannelMetricDaily";
CREATE POLICY tenant_isolation ON "ChannelMetricDaily" USING (EXISTS (SELECT 1 FROM "Channel" c WHERE c.id = "channelId" AND c."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "PostMetric" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PostMetric" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PostMetric";
CREATE POLICY tenant_isolation ON "PostMetric" USING (EXISTS (SELECT 1 FROM "PostTarget" t WHERE t.id = "postTargetId" AND t."organizationId" = current_setting('app.org_id', true)::uuid));

ALTER TABLE "AudienceSnapshot" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AudienceSnapshot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AudienceSnapshot";
CREATE POLICY tenant_isolation ON "AudienceSnapshot" USING (EXISTS (SELECT 1 FROM "Channel" c WHERE c.id = "channelId" AND c."organizationId" = current_setting('app.org_id', true)::uuid));

-- Credentials: only relay_vault may touch them
REVOKE ALL ON "ChannelCredential" FROM relay;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ChannelCredential" TO relay_vault;

-- Account/Session/OAuthIdentity/ApiKey lookups happen before a tenant is known → no RLS (guarded in code)
