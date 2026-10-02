'use client';

import { useState, type FormEvent } from 'react';
import { api, fieldErrors } from '@/lib/api';
import { Alert, Button, Card, Checkbox, ErrorAlert, Field, Input, Select } from './ui';

type Type = 'DEALERSHIP' | 'DEALER';

const LEGAL_FORMS = ['GmbH', 'GmbH & Co. KG', 'AG', 'KG', 'OHG', 'e.K.', 'UG (haftungsbeschränkt)', 'GbR', 'Einzelunternehmen', 'Sonstige'];

export function RegistrationForm({ type }: { type: Type }) {
  const [v, setV] = useState({
    name: '',
    legalForm: 'GmbH',
    street: '',
    houseNumber: '',
    zip: '',
    city: '',
    website: '',
    registerNumber: '',
    vatId: '',
    brands: '',
    tradeType: '',
    bankIban: '',
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    password: '',
    passwordRepeat: '',
  });
  const [tradeLicense, setTradeLicense] = useState<File | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptBidderTerms, setAcceptBidderTerms] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const fe = fieldErrors(error);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (v.password !== v.passwordRepeat) {
      setError(new Error('Die Passwörter stimmen nicht überein.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStep('Registrierung wird angelegt …');
      const common = {
        name: v.name,
        legalForm: v.legalForm,
        street: v.street,
        houseNumber: v.houseNumber,
        zip: v.zip,
        city: v.city,
        website: v.website || null,
        registerNumber: v.registerNumber || null,
        vatId: v.vatId || null,
        firstName: v.firstName,
        lastName: v.lastName,
        phone: v.phone,
        email: v.email,
        password: v.password,
        acceptTerms,
        acceptPrivacy,
      };
      const body =
        type === 'DEALERSHIP'
          ? { ...common, brands: v.brands.split(',').map((b) => b.trim()).filter(Boolean) }
          : { ...common, tradeType: v.tradeType, bankIban: v.bankIban || null, acceptBidderTerms };
      await api(type === 'DEALERSHIP' ? '/register/dealership' : '/register/dealer', { method: 'POST', body });
      if (tradeLicense) {
        setStep('Gewerbenachweis wird hochgeladen …');
        const fd = new FormData();
        fd.append('kind', 'TRADE_LICENSE');
        fd.append('file', tradeLicense);
        await api('/company/documents', { method: 'POST', body: fd });
      } else {
        await api('/register/submit', { method: 'POST' });
      }
      window.location.href = '/registrierung/status';
    } catch (err) {
      setError(err);
      setBusy(false);
      setStep(null);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Card title="Unternehmen">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Firmenname" required error={fe.name} className="sm:col-span-2">
            <Input value={v.name} onChange={set('name')} invalid={!!fe.name} autoComplete="organization" />
          </Field>
          <Field label="Rechtsform" required error={fe.legalForm}>
            <Select value={v.legalForm} onChange={set('legalForm')}>
              {LEGAL_FORMS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Website" error={fe.website}>
            <Input value={v.website} onChange={set('website')} placeholder="https://" />
          </Field>
          <Field label="Straße" required error={fe.street}>
            <Input value={v.street} onChange={set('street')} invalid={!!fe.street} autoComplete="address-line1" />
          </Field>
          <Field label="Hausnummer" required error={fe.houseNumber}>
            <Input value={v.houseNumber} onChange={set('houseNumber')} invalid={!!fe.houseNumber} />
          </Field>
          <Field label="PLZ" required error={fe.zip}>
            <Input value={v.zip} onChange={set('zip')} inputMode="numeric" invalid={!!fe.zip} autoComplete="postal-code" />
          </Field>
          <Field label="Ort" required error={fe.city}>
            <Input value={v.city} onChange={set('city')} invalid={!!fe.city} autoComplete="address-level2" />
          </Field>
          <Field label="Handelsregister (optional)" error={fe.registerNumber}>
            <Input value={v.registerNumber} onChange={set('registerNumber')} placeholder="z. B. HRB 12345, AG Hannover" />
          </Field>
          <Field label={type === 'DEALER' ? 'Umsatzsteuer-ID' : 'Umsatzsteuer-ID (optional)'} required={type === 'DEALER'} error={fe.vatId}>
            <Input value={v.vatId} onChange={set('vatId')} invalid={!!fe.vatId} placeholder="DE123456789" />
          </Field>
          {type === 'DEALERSHIP' ? (
            <Field label="Marken / Vertragspartnerschaften" hint="Kommagetrennt, z. B. VW, Audi, Škoda" error={fe.brands} className="sm:col-span-2">
              <Input value={v.brands} onChange={set('brands')} />
            </Field>
          ) : (
            <>
              <Field label="Gewerbeart" required error={fe.tradeType}>
                <Input value={v.tradeType} onChange={set('tradeType')} invalid={!!fe.tradeType} placeholder="z. B. Kfz-Handel" />
              </Field>
              <Field label="Bankverbindung (IBAN, optional)" error={fe.bankIban}>
                <Input value={v.bankIban} onChange={set('bankIban')} autoComplete="off" />
              </Field>
            </>
          )}
        </div>
      </Card>

      <Card title="Ansprechpartner und Zugang">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vorname" required error={fe.firstName}>
            <Input value={v.firstName} onChange={set('firstName')} invalid={!!fe.firstName} autoComplete="given-name" />
          </Field>
          <Field label="Nachname" required error={fe.lastName}>
            <Input value={v.lastName} onChange={set('lastName')} invalid={!!fe.lastName} autoComplete="family-name" />
          </Field>
          <Field label="Telefonnummer" required error={fe.phone}>
            <Input value={v.phone} onChange={set('phone')} type="tel" invalid={!!fe.phone} autoComplete="tel" />
          </Field>
          <Field label="E-Mail" required error={fe.email}>
            <Input value={v.email} onChange={set('email')} type="email" invalid={!!fe.email} autoComplete="email" />
          </Field>
          <Field label="Passwort" required hint="Mindestens 10 Zeichen, Buchstaben und Ziffern" error={fe.password}>
            <Input value={v.password} onChange={set('password')} type="password" invalid={!!fe.password} autoComplete="new-password" />
          </Field>
          <Field label="Passwort wiederholen" required>
            <Input value={v.passwordRepeat} onChange={set('passwordRepeat')} type="password" autoComplete="new-password" />
          </Field>
        </div>
      </Card>

      <Card title="Nachweise">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gewerbenachweis" required hint="PDF, JPG oder PNG, max. 25 MB. Ohne Nachweis bleibt der Status „Unterlagen fehlen“.">
            <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setTradeLicense(e.target.files?.[0] ?? null)} className="text-sm" />
          </Field>
        </div>
      </Card>

      <Card title="Bedingungen">
        <div className="space-y-3">
          <Checkbox checked={acceptTerms} onChange={setAcceptTerms} label={<>Ich akzeptiere die <a href="/rechtliches/TERMS" target="_blank" className="text-brand-700 underline">AGB</a>.</>} />
          {type === 'DEALER' && (
            <Checkbox
              checked={acceptBidderTerms}
              onChange={setAcceptBidderTerms}
              label={<>Ich akzeptiere die <a href="/rechtliches/BIDDER_TERMS" target="_blank" className="text-brand-700 underline">Bieter- und Auktionsbedingungen</a>. Gebote sind verbindlich.</>}
            />
          )}
          <Checkbox checked={acceptPrivacy} onChange={setAcceptPrivacy} label={<>Ich habe die <a href="/rechtliches/PRIVACY" target="_blank" className="text-brand-700 underline">Datenschutzerklärung</a> gelesen und akzeptiere sie.</>} />
          {(fe.acceptTerms || fe.acceptPrivacy || fe.acceptBidderTerms) && <Alert tone="danger">Bitte alle Bedingungen akzeptieren.</Alert>}
        </div>
      </Card>

      <ErrorAlert error={Object.keys(fe).length ? new Error('Bitte die markierten Felder prüfen.') : error} />
      {step && <Alert tone="progress">{step}</Alert>}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Registrierung absenden
      </Button>
    </form>
  );
}
