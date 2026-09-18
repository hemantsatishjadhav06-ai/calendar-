import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_ADMIN }) });

// A real argon2id hash of "password" so the seed account can sign in in every environment (including production).
const SEED_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$ykhOyh7U4FpNycJBSZdkgQ$TkKzeXwjyZ2MpLhlklcSCkkCBO06BWbG9p4ZGmiVu8w';

async function main() {
  const owner = await prisma.account.upsert({ where: { email: 'owner@relay.local' }, update: { passwordHash: SEED_PASSWORD_HASH }, create: { email: 'owner@relay.local', name: 'Ana Owner', emailVerifiedAt: new Date(), passwordHash: SEED_PASSWORD_HASH, timezone: 'Asia/Kolkata' } });
  const org = await prisma.organization.upsert({ where: { slug: 'acme' }, update: {}, create: { name: 'Acme Inc', slug: 'acme', ownerAccountId: owner.id, settings: { linkShortener: 'relay', utm: { enabled: true, utm_source: '{network}', utm_medium: 'social' } } } });
  await prisma.membership.upsert({ where: { accountId_organizationId: { accountId: owner.id, organizationId: org.id } }, update: {}, create: { accountId: owner.id, organizationId: org.id, role: 'OWNER' } });
  await prisma.subscription.upsert({ where: { organizationId: org.id }, update: {}, create: { organizationId: org.id, plan: 'TEAM', channelQuantity: 10, status: 'trialing', trialEndsAt: new Date(Date.now() + 14 * 864e5) } });
  for (const [name, color] of [['Launch', '#6DB44F'], ['Evergreen', '#2C4BFF'], ['Hiring', '#F79009']] as const) {
    await prisma.tag.upsert({ where: { organizationId_name: { organizationId: org.id, name } }, update: {}, create: { organizationId: org.id, name, color } });
  }
  await prisma.ideaGroup.createMany({ data: [{ organizationId: org.id, name: 'Inbox', sortOrder: 0 }, { organizationId: org.id, name: 'Q4 campaign', sortOrder: 1 }], skipDuplicates: true });
  const templates = [
    ['Product launch', 'Today we are launching {product}. Here is why we built it: {reason}. Try it: {link}', 'Launch'],
    ['Customer story', '"{quote}" — {customer}. Read how {customer} uses {product}: {link}', 'Social proof'],
    ['Behind the scenes', 'A peek behind the curtain: {what we are working on}. What would you like to see next?', 'Culture'],
    ['Tip of the week', 'Quick tip: {tip}. Save this for later.', 'Education'],
    ['Question', 'Quick question for our community: {question}? Reply below.', 'Engagement'],
  ];
  for (const [title, body, category] of templates) await prisma.template.create({ data: { title, body, category, isLibrary: true } }).catch(() => {});
  console.log('seeded org', org.slug, 'login owner@relay.local / password');
}
main().finally(() => prisma.$disconnect());
