import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function SlideTrack({
  className,
  active,
  children,
}: {
  className?: string;
  active: string | number | boolean | null;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const thumb = thumbRef.current;
    if (!root || !thumb) return;

    const hit = root.querySelector('[data-slide-active="true"]');
    if (!(hit instanceof HTMLElement)) {
      thumb.dataset.on = 'false';
      return;
    }

    const arriving = thumb.dataset.on !== 'true';
    if (arriving) thumb.style.transition = 'none';
    thumb.style.width = `${hit.offsetWidth}px`;
    thumb.style.height = `${hit.offsetHeight}px`;
    thumb.style.transform = `translate(${hit.offsetLeft}px, ${hit.offsetTop}px)`;
    thumb.dataset.on = 'true';
    if (arriving) {
      void thumb.offsetWidth;
      thumb.style.transition = '';
    }
  }, [active]);

  return (
    <div ref={rootRef} className={className}>
      <span className="slide-thumb" ref={thumbRef} aria-hidden="true" />
      {children}
    </div>
  );
}
