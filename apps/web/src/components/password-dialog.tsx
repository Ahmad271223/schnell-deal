'use client';

import { useState } from 'react';
import { api, fieldErrors } from '@/lib/api';
import { Alert, Button, ErrorAlert, Field, Input, Modal } from './ui';

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const fe = fieldErrors(error);

  const submit = async () => {
    if (next !== repeat) {
      setError(new Error('Die neuen Passwörter stimmen nicht überein.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setDone(true);
      setTimeout(() => (window.location.href = '/login'), 1500);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Passwort ändern"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={submit} loading={busy} disabled={!current || !next || done}>
            Passwort ändern
          </Button>
        </>
      }
    >
      {done ? (
        <Alert tone="success" title="Passwort geändert">
          Aus Sicherheitsgründen wurden alle Sitzungen beendet. Bitte melden Sie sich neu an.
        </Alert>
      ) : (
        <div className="space-y-3">
          <Field label="Aktuelles Passwort" required>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Neues Passwort" required hint="Mindestens 10 Zeichen, Buchstaben und Ziffern" error={fe.newPassword}>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Neues Passwort wiederholen" required>
            <Input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          <ErrorAlert error={Object.keys(fe).length ? null : error} />
        </div>
      )}
    </Modal>
  );
}
