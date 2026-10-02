'use client';

import { ImagePlus, Loader2, Trash2, Video } from 'lucide-react';
import { useRef, useState } from 'react';
import { PHOTO_SLOT_LABELS } from '@sd/shared';
import { api, photoUrl, vehicleVideoUrl } from '@/lib/api';
import type { VehicleFile } from '@/lib/types';
import { Button } from './ui';

/**
 * Direkter Medien-Upload (Admin): Fotos und Motor-Video pro Fahrzeug – ohne den Aufnahmeprozess.
 * Fotos landen sofort im Katalog (erstes Bild = Kartenbild) und in der Galerie der Auktionsseite.
 */
export function VehicleMediaManager({ file, onChange }: { file: VehicleFile; onChange: () => void }) {
  const vehicleId = file.id;
  const photos = file.photos.filter((p) => !p.replaced);
  const [busy, setBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bust, setBust] = useState(0);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const post = async (url: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(url, { method: 'POST', body: fd, credentials: 'include' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? 'Upload fehlgeschlagen.');
  };

  const uploadPhotos = async (files: FileList) => {
    setBusy(true);
    setErr(null);
    try {
      for (const f of Array.from(files)) await post(`/api/v1/vehicles/${vehicleId}/media/photo`, f);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload fehlgeschlagen.');
    } finally {
      setBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  };

  const deletePhoto = async (photoId: string) => {
    setErr(null);
    try {
      await api(`/vehicles/${vehicleId}/media/photo/${photoId}`, { method: 'DELETE' });
      onChange();
    } catch {
      setErr('Foto konnte nicht gelöscht werden.');
    }
  };

  const uploadVideo = async (f: File) => {
    setVideoBusy(true);
    setErr(null);
    try {
      await post(`/api/v1/vehicles/${vehicleId}/media/video`, f);
      setBust(Date.now());
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Video-Upload fehlgeschlagen.');
    } finally {
      setVideoBusy(false);
      if (videoInput.current) videoInput.current.value = '';
    }
  };

  const removeVideo = async () => {
    setVideoBusy(true);
    setErr(null);
    try {
      await api(`/vehicles/${vehicleId}/media/video`, { method: 'DELETE' });
      setBust(Date.now());
      onChange();
    } catch {
      setErr('Video konnte nicht entfernt werden.');
    } finally {
      setVideoBusy(false);
    }
  };

  return (
    <div data-testid="media-manager">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-slate-900">Fotos & Motor-Video</h3>
          <p className="text-xs text-slate-500">Direkter Upload ohne Aufnahmeprozess. Das erste Foto wird zum Katalog-Bild.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
          Fotos hinzufügen
          <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" disabled={busy} data-testid="media-photo-input" onChange={(e) => e.target.files?.length && uploadPhotos(e.target.files)} />
        </label>
      </div>

      {err && <p className="mt-2 text-sm text-brand-700" data-testid="media-error">{err}</p>}

      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((p) => (
          <li key={p.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(vehicleId, p.id, 'thumb')} alt={PHOTO_SLOT_LABELS[p.slot]} loading="lazy" className="aspect-[4/3] w-full object-cover" />
            <button onClick={() => deletePhoto(p.id)} className="absolute right-1 top-1 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-brand-600 group-hover:opacity-100" aria-label="Foto löschen" data-testid={`media-delete-${p.id}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {photos.length === 0 && <li className="col-span-full rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">Noch keine Fotos.</li>}
      </ul>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Video className="h-4 w-4 text-slate-500" aria-hidden /> Motor-/Fahrzeugvideo</h4>
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {videoBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Video className="h-4 w-4" aria-hidden />}
              {file.hasEngineVideo ? 'Video ersetzen' : 'Video hochladen'}
              <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" disabled={videoBusy} data-testid="media-video-input" onChange={(e) => e.target.files?.[0] && uploadVideo(e.target.files[0])} />
            </label>
            {file.hasEngineVideo && <Button variant="ghost" onClick={removeVideo} disabled={videoBusy}>Entfernen</Button>}
          </div>
        </div>
        {file.hasEngineVideo ? (
          <video key={bust} src={`${vehicleVideoUrl(vehicleId)}?v=${bust}`} controls preload="metadata" playsInline className="mt-3 aspect-video w-full max-w-xl rounded-lg border border-slate-200 bg-black" data-testid="media-video-preview" />
        ) : (
          <p className="mt-2 text-xs text-slate-500">MP4, WebM oder MOV. Wird auf der Auktionsseite unter der Galerie angezeigt.</p>
        )}
      </div>
    </div>
  );
}
