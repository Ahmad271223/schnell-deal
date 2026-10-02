'use client';

import Link from 'next/link';
import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { homePath, type Me } from '@/lib/session';
import { Button, Card, ErrorAlert, Field, Input } from '@/components/ui';
import { PublicLayout } from '@/components/public-layout';

function LoginForm() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      const me = await api<Me>('/auth/me');
      qc.setQueryData(['me'], me);
      const next = params.get('next');
      // Nur interne Pfade als Weiterleitungsziel zulassen (Open-Redirect-Schutz).
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : homePath(me);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Anmelden</h1>
      <p className="mb-5 text-sm text-slate-500">Für Autohäuser, Händler, Außendienst und Administration.</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="E-Mail" htmlFor="email" required>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Passwort" htmlFor="password" required>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorAlert error={error} />
        <Button type="submit" className="w-full" loading={busy}>
          Anmelden
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Noch kein Zugang? <Link href="/registrieren" className="text-brand-700 hover:underline">Unternehmen registrieren</Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <PublicLayout>
      <Suspense>
        <LoginForm />
      </Suspense>
    </PublicLayout>
  );
}
