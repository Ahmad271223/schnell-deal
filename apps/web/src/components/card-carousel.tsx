'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Horizontale Kartenreihe zum Wischen (Scroll-Snap): auf Touch-Geräten mit dem Finger, am Desktop mit
 * Mausziehen, Pfeiltasten oder den Pfeilschaltflächen. Kein eigenes Layout-Skript, der Browser scrollt.
 */
export function CardCarousel({ title, subtitle, icon: Icon, action, children, testId }: { title: string; subtitle?: ReactNode; icon?: LucideIcon; action?: ReactNode; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [update, children]);

  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section className="relative" aria-label={title} data-testid={testId}>
      <header className="mb-3 flex items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-[19px] font-bold tracking-tight text-slate-950">
            {Icon && <Icon className="h-5 w-5 text-slate-500" aria-hidden />}
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="relative">
        <div
          ref={ref}
          role="list"
          tabIndex={0}
          className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-1 pb-1.5 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          style={{ scrollPaddingInline: 4 }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            page(e.key === 'ArrowRight' ? 1 : -1);
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse' || !ref.current) return;
            drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
            ref.current.style.scrollSnapType = 'none';
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || !ref.current) return;
            const dx = e.clientX - d.x;
            if (Math.abs(dx) > 5) d.moved = true;
            if (d.moved) ref.current.scrollLeft = d.left - dx;
          }}
          onPointerUp={() => {
            if (ref.current) ref.current.style.scrollSnapType = '';
            // Nach einem Ziehen den Klick auf die Karte unterdrücken (sonst würde die Seite wechseln).
            const moved = drag.current?.moved;
            drag.current = null;
            if (moved && ref.current) {
              const el = ref.current;
              const swallow = (ev: Event) => {
                ev.preventDefault();
                ev.stopPropagation();
              };
              el.addEventListener('click', swallow, { capture: true, once: true });
              setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
            }
          }}
          onPointerLeave={() => {
            drag.current = null;
            if (ref.current) ref.current.style.scrollSnapType = '';
          }}
        >
          {children}
        </div>
        <ArrowButton side="left" hidden={edge.start} onClick={() => page(-1)} />
        <ArrowButton side="right" hidden={edge.end} onClick={() => page(1)} />
      </div>
    </section>
  );
}

function ArrowButton({ side, hidden, onClick }: { side: 'left' | 'right'; hidden: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Zurück' : 'Weiter'}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : 0}
      className={clsx(
        'absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/60 bg-white/85 text-slate-800 shadow-lg shadow-slate-900/10 backdrop-blur-md transition-all hover:bg-white sm:flex',
        side === 'left' ? 'left-1' : 'right-1',
        hidden && 'pointer-events-none opacity-0',
      )}
    >
      {side === 'left' ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
    </button>
  );
}

/** Eine Karte in der Reihe; Breite so, dass am Smartphone die nächste Karte schon anklingt. */
export function CarouselItem({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div role="listitem" className={clsx('shrink-0 snap-start', wide ? 'w-[min(86vw,360px)]' : 'w-[min(78vw,276px)]', className)}>
      {children}
    </div>
  );
}
