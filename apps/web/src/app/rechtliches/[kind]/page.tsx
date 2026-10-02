'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateDe, LEGAL_KIND_LABELS, type LegalKind } from '@sd/shared';
import { api } from '@/lib/api';
import { Alert, Card, QueryState } from '@/components/ui';
import { PublicLayout } from '@/components/public-layout';

interface LegalDoc {
  id: string;
  kind: LegalKind;
  version: string;
  title: string;
  content: string;
  activeFrom: string;
}

export default function LegalPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  const q = useQuery({ queryKey: ['legal'], queryFn: () => api<LegalDoc[]>('/legal/current') });
  const doc = q.data?.find((d) => d.kind === kind);
  return (
    <PublicLayout wide>
      <QueryState query={q}>
        {doc ? (
          <Card title={`${doc.title} – Version ${doc.version}`}>
            <p className="mb-4 text-xs text-slate-500">
              {LEGAL_KIND_LABELS[doc.kind]} · gültig ab {formatDateDe(doc.activeFrom)}
            </p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{doc.content}</div>
          </Card>
        ) : (
          <Alert tone="warning">Dieser Rechtstext ist noch nicht hinterlegt.</Alert>
        )}
      </QueryState>
    </PublicLayout>
  );
}
