import { eq, sql } from 'drizzle-orm';
import { approxCoordinatesForZip } from '@sd/shared';
import { db, pool, schema } from '../core/db/client';
import { runMigrations } from '../core/db/migrate';
import { hashPassword } from '../core/auth';
import { activeLegalDocuments } from '../modules/legal/service';
import { ensureLegalTemplates, ensureSettings, ensureSuperadmin } from './seed-base';

/**
 * Basis-Seed (idempotent): Migrationen, Rechtstext-VORLAGEN, Plattform-Einstellungen, Superadmin.
 *   pnpm db:seed
 * Demo-Seed (nur Entwicklung/Staging, nie Produktion): zusätzlich Außendienst, ein Autohaus und drei Händler.
 *   pnpm db:seed -- --demo
 * Fahrzeuge werden bewusst NICHT erzeugt – sie entstehen ausschließlich über den echten Aufnahmeprozess.
 */
async function main() {
  const demo = process.argv.includes('--demo');
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.error('Bitte SEED_ADMIN_EMAIL und SEED_ADMIN_PASSWORD setzen (siehe .env.example).');
    process.exit(1);
  }
  if (demo && process.env.NODE_ENV === 'production') {
    console.error('Demo-Daten dürfen nicht in Produktion angelegt werden.');
    process.exit(1);
  }
  await runMigrations();
  await db.transaction(async (tx) => {
    await ensureLegalTemplates(tx);
    await ensureSettings(tx);
    await ensureSuperadmin(tx, adminEmail, adminPassword);
  });
  console.log(`Basis-Seed fertig. Superadmin: ${adminEmail}`);

  if (demo) {
    const password = process.env.SEED_DEMO_PASSWORD;
    if (!password) {
      console.error('Für --demo bitte SEED_DEMO_PASSWORD setzen.');
      process.exit(1);
    }
    const hash = await hashPassword(password);
    const legal = await activeLegalDocuments(db);
    const user = async (email: string, firstName: string, lastName: string, role: 'INSPECTOR' | 'USER', phone: string) => {
      const [existing] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
      if (existing) return existing.id;
      const [u] = await db.insert(schema.users).values({ email, passwordHash: hash, firstName, lastName, platformRole: role, phone }).returning({ id: schema.users.id });
      return u!.id;
    };
    const company = async (type: 'DEALERSHIP' | 'DEALER', name: string, zip: string, city: string, email: string, first: string, last: string) => {
      const [existing] = await db.select().from(schema.companies).where(eq(schema.companies.contactEmail, email));
      if (existing) return existing.id;
      const c0 = approxCoordinatesForZip(zip);
      const [c] = await db
        .insert(schema.companies)
        .values({
          type,
          name,
          legalForm: 'GmbH',
          street: 'Musterstraße',
          houseNumber: '1',
          zip,
          city,
          vatId: 'DE000000000',
          brands: type === 'DEALERSHIP' ? ['Volkswagen', 'Audi'] : [],
          tradeType: type === 'DEALER' ? 'Kfz-Handel' : null,
          contactFirstName: first,
          contactLastName: last,
          contactPhone: '+49 511 0000000',
          contactEmail: email,
          status: 'APPROVED',
          lat: c0?.lat ?? null,
          lng: c0?.lng ?? null,
        })
        .returning({ id: schema.companies.id });
      const uid = await user(email, first, last, 'USER', '+49 511 0000000');
      await db.insert(schema.companyUsers).values({ companyId: c!.id, userId: uid, companyRole: 'OWNER' }).onConflictDoNothing();
      if (type === 'DEALER') await db.insert(schema.dealerVerifications).values({ companyId: c!.id, biddingStatus: 'CAN_BID' }).onConflictDoNothing();
      await db
        .insert(schema.legalAcceptances)
        .values(legal.map((l) => ({ userId: uid, companyId: c!.id, legalDocumentId: l.id })))
        .onConflictDoNothing();
      return c!.id;
    };
    await user('aussendienst@demo.schnell-deal.local', 'Max', 'Mustermann', 'INSPECTOR', '+49 170 0000001');
    await company('DEALERSHIP', '[DEMO] Autohaus Ahrens', '30159', 'Hannover', 'autohaus@demo.schnell-deal.local', 'Anna', 'Ahrens');
    await company('DEALER', '[DEMO] Händler Nord', '22041', 'Hamburg', 'haendler1@demo.schnell-deal.local', 'Bernd', 'Nord');
    await company('DEALER', '[DEMO] Händler Mitte', '34117', 'Kassel', 'haendler2@demo.schnell-deal.local', 'Clara', 'Mitte');
    await company('DEALER', '[DEMO] Händler Süd', '80331', 'München', 'haendler3@demo.schnell-deal.local', 'Dieter', 'Süd');
    console.log('Demo-Benutzer angelegt (Passwort: SEED_DEMO_PASSWORD). Alle Namen sind mit [DEMO] gekennzeichnet.');
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
