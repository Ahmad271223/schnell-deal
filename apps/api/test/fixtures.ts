import crypto from 'node:crypto';
import { db, schema } from '../src/core/db/client';
import { hashPassword } from '../src/core/auth';
import { activeLegalDocuments } from '../src/modules/legal/service';
import { PASSWORD } from './helpers';

let cachedHash: string | null = null;
async function pwHash(): Promise<string> {
  if (!cachedHash) cachedHash = await hashPassword(PASSWORD);
  return cachedHash;
}

/**
 * Schnelle Fixture für Last-/Concurrency-Tests: freigegebener, bietberechtigter Händler
 * inkl. Zustimmung zu den aktuellen Rechtstexten – direkt in der DB.
 */
export async function fixtureDealer(i: number): Promise<{ companyId: string; userId: string; email: string }> {
  const tag = crypto.randomBytes(4).toString('hex');
  const email = `load-${i}-${tag}@haendler.test`;
  const [c] = await db
    .insert(schema.companies)
    .values({
      type: 'DEALER',
      name: `Lasttest Händler ${i} ${tag}`,
      legalForm: 'GmbH',
      street: 'Teststraße',
      houseNumber: String(i),
      zip: '30159',
      city: 'Hannover',
      vatId: `DE${String(100000000 + i)}`,
      tradeType: 'Kfz-Handel',
      contactFirstName: 'Last',
      contactLastName: `Test${i}`,
      contactPhone: '+49 511 000000',
      contactEmail: email,
      status: 'APPROVED',
      lat: 52.37,
      lng: 9.73,
    })
    .returning({ id: schema.companies.id });
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: await pwHash(), firstName: 'Last', lastName: `Test${i}`, platformRole: 'USER' })
    .returning({ id: schema.users.id });
  await db.insert(schema.companyUsers).values({ companyId: c!.id, userId: u!.id, companyRole: 'OWNER' });
  await db.insert(schema.dealerVerifications).values({ companyId: c!.id, biddingStatus: 'CAN_BID' });
  const legal = await activeLegalDocuments(db, ['TERMS', 'PRIVACY', 'BIDDER_TERMS']);
  await db.insert(schema.legalAcceptances).values(legal.map((l) => ({ userId: u!.id, companyId: c!.id, legalDocumentId: l.id })));
  return { companyId: c!.id, userId: u!.id, email };
}
