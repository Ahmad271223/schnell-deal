'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ImageOff, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PHOTO_QUALITY_LABELS, PHOTO_SLOT_LABELS, type PhotoQuality, type PhotoSlot } from '@sd/shared';
import { photoUrl } from '@/lib/api';
import { StatusBadge } from './ui';

export interface GalleryPhoto {
  id: string;
  slot: PhotoSlot;
  quality?: PhotoQuality;
  qualityOverride?: boolean;
  replaced?: boolean;
  processed?: boolean;
}

export function PhotoGallery({ vehicleId, photos, showQuality }: { vehicleId: string; photos: GalleryPhoto[]; showQuality?: boolean }) {
  const [index, setIndex] = useState<number | null>(null);
  const visible = photos.filter((p) => !p.replaced);
  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        <ImageOff className="h-4 w-4" aria-hidden /> Keine Fotos vorhanden.
      </div>
    );
  }
  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((p, i) => (
          <li key={p.id}>
            <button className="group relative block w-full overflow-hidden rounded-md border border-slate-200 bg-slate-100" onClick={() => setIndex(i)} aria-label={`${PHOTO_SLOT_LABELS[p.slot]} vergrößern`}>
              <img src={photoUrl(vehicleId, p.id, 'thumb')} alt={PHOTO_SLOT_LABELS[p.slot]} loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-left text-xs font-medium text-white">{PHOTO_SLOT_LABELS[p.slot]}</span>
            </button>
            {showQuality && p.quality && p.quality !== 'OK' && (
              <div className="mt-1">
                <StatusBadge label={p.qualityOverride ? `${PHOTO_QUALITY_LABELS[p.quality][0]} (übersteuert)` : PHOTO_QUALITY_LABELS[p.quality][0]} tone={p.qualityOverride ? 'warning' : 'danger'} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {index !== null && <Lightbox vehicleId={vehicleId} photos={visible} index={index} onIndex={setIndex} onClose={() => setIndex(null)} />}
    </>
  );
}

export function Lightbox({ vehicleId, photos, index, onIndex, onClose }: { vehicleId: string; photos: GalleryPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const photo = photos[index]!;
  const go = useCallback(
    (d: number) => {
      onIndex((index + d + photos.length) % photos.length);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    },
    [index, photos.length, onIndex],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === '+') setZoom((z) => Math.min(5, z + 0.5));
      if (e.key === '-') setZoom((z) => Math.max(1, z - 0.5));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Fotoansicht">
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm">
          {PHOTO_SLOT_LABELS[photo.slot]} · {index + 1}/{photos.length}
        </span>
        <div className="flex items-center gap-1">
          <button className="rounded p-2 hover:bg-white/10" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Verkleinern">
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="tabular w-12 text-center text-sm">{Math.round(zoom * 100)} %</span>
          <button className="rounded p-2 hover:bg-white/10" onClick={() => setZoom((z) => Math.min(5, z + 0.5))} aria-label="Vergrößern">
            <ZoomIn className="h-5 w-5" />
          </button>
          <button className="rounded p-2 hover:bg-white/10" onClick={onClose} aria-label="Schließen">
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>
      <div
        className={clsx('relative flex flex-1 items-center justify-center overflow-hidden', zoom > 1 ? 'cursor-grab' : 'cursor-zoom-in')}
        onWheel={(e) => setZoom((z) => Math.min(5, Math.max(1, z + (e.deltaY < 0 ? 0.25 : -0.25))))}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(e) => drag.current && setOffset({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y })}
        onPointerUp={() => (drag.current = null)}
      >
        <img
          src={photoUrl(vehicleId, photo.id, 'web')}
          alt={PHOTO_SLOT_LABELS[photo.slot]}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transition: drag.current ? 'none' : 'transform 0.15s' }}
        />
        <button className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20" onClick={() => go(-1)} aria-label="Vorheriges Foto">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20" onClick={() => go(1)} aria-label="Nächstes Foto">
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
