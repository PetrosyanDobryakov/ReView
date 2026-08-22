import { useEffect, useRef, useState } from 'react';

export function SwapText({ text }: { text: string }) {
  const prev = useRef(text);
  const skip = useRef(true);
  const [leaving, setLeaving] = useState<string | null>(null);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (text === prev.current) return;
    setLeaving(prev.current);
    prev.current = text;
    const id = window.setTimeout(() => setLeaving(null), 240);
    return () => window.clearTimeout(id);
  }, [text]);

  return (
    <span className="swap-text">
      {leaving ? <span className="swap-out">{leaving}</span> : null}
      <span className={leaving ? 'swap-in' : undefined} key={text}>
        {text}
      </span>
    </span>
  );
}
