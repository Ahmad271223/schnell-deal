'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COMPANY_STATUS_LABELS, type CompanyStatus } from '@sd/shared';
import { api, ApiError } from '@/lib/api';
import { homePath, useLogout, useMe } from '@/lib/session';
import { Alert, Button, Card, ErrorAlert, Field, Spinner, statusBadge } from '@/components/ui';
import { PublicLayout } from '@/components/public-layout';

interface RegStatus {
  status: CompanyStatus | null;
  reviewNote: string | null;
  hasTradeLicense: boolean;
  type: 'DEALERSHIP' | 'DEALER';
}

export default function RegistrationStatusPage() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useLogout();
  const status = useQuery({ queryKey: ['register-status'], queryFn: () => api<RegStatus>('/register/status'), enabled: !!me.data, refetchInterval: 30_000 });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace('/login');
    if (status.data?.status === 'APPROVED' && me.data) {
      void qc.invalidateQueries({ queryKey: ['me'] }).then(() => router.replace(homePath({ ...me.data!, company: me.data!.company && { ...me.data!.company, status: 'APPROVED' } })));
    }
  }, [me.error, me.data, status.data, router, qc]);

  const uploadDoc = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('kind', 'TRADE_LICENSE');
      fd.append('file', file);
      await api('/company/documents', { method: 'POST', body: fd });
      setFile(null);
      await status.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (me.isLoading || status.isLoading) return <PublicLayout><Spinner /></PublicLayout>;
  const s = status.data;
  return (
    <PublicLayout wide>
      <Card title="Status Ihrer Registrierung">
        {!s?.status ? (
          <Alert tone="warning">Kein Unternehmen zugeordnet.</Alert>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">{me.data?.company?.name}</span>
              {statusBadge(COMPANY_STATUS_LABELS, s.status)}
            </div>
            {s.status === 'IN_REVIEW' && <Alert tone="info" title="Prüfung läuft">Wir prüfen Ihre Unterlagen. Sie werden per E-Mail benachrichtigt, sobald Ihr Konto freigegeben ist.</Alert>}
            {s.status === 'REJECTED' && <Alert tone="danger" title="Registrierung abgelehnt">{s.reviewNote ?? 'Bitte wenden Sie sich an den Plattformbetreiber.'}</Alert>}
            {(s.status === 'DOCUMENTS_MISSING' || s.status === 'REGISTRATION_STARTED') && (
              <>
                <Alert tone="warning" title="Unterlagen fehlen">{s.reviewNote ?? 'Bitte laden Sie Ihren Gewerbenachweis hoch, damit wir Ihre Registrierung prüfen können.'}</Alert>
                <Field label="Gewerbenachweis hochladen" hint="PDF, JPG oder PNG, max. 25 MB">
                  <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
                </Field>
                <Button onClick={uploadDoc} disabled={!file} loading={busy}>
                  Hochladen und zur Prüfung einreichen
                </Button>
                <ErrorAlert error={error} />
              </>
            )}
            {s.status === 'BLOCKED' && <Alert tone="danger" title="Konto gesperrt">Bitte wenden Sie sich an den Plattformbetreiber.</Alert>}
          </div>
        )}
        <div className="mt-6 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={logout}>
            Abmelden
          </Button>
        </div>
      </Card>
    </PublicLayout>
  );
}
