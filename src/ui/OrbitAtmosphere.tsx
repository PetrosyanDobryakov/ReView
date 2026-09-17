import { Warp } from '@paper-design/shaders-react';
import { useEffect, useState } from 'react';
import { ORBIT_COLORS } from '../core/orbit';

/**
 * Violet Swirl (21st / Silk) — idle animation only, no pointer parallax.
 * Preview: https://21st.dev/@serafimcloud/components/violet-swirl
 */
const ORBIT_SHADER_COLORS = [
  ORBIT_COLORS.void,
  ORBIT_COLORS.deep,
  '#1A1240',
  ORBIT_COLORS.indigo,
  ORBIT_COLORS.lilac,
];

function readWarpCovered(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.orbitWarpCovered === '1';
}

export function OrbitAtmosphere() {
  const [reduce, setReduce] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [visible, setVisible] = useState(() => typeof document !== 'undefined' && !document.hidden);
  /** Board solid/non-Orbit paper fills the canvas opaquely — Warp is fully covered. */
  const [covered, setCovered] = useState(readWarpCovered);

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => setReduce(mq.matches);
    mq.addEventListener('change', onMq);
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    const onCover = (e: Event) => {
      const detail = (e as CustomEvent<{ covered?: boolean }>).detail;
      setCovered(Boolean(detail?.covered));
    };
    window.addEventListener('review-orbit-warp-cover', onCover);
    // Sync in case Engine set the dataset before this listener attached.
    setCovered(readWarpCovered());
    return () => {
      mq.removeEventListener('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('review-orbit-warp-cover', onCover);
    };
  }, []);

  // Pause only when invisible: reduced-motion, tab hidden, or solid paper covers Warp.
  // Never pause on home / Orbit paper — atmosphere is meant to be seen there.
  const paused = reduce || !visible || covered;

  return (
    <div className="orbit-atmosphere" aria-hidden="true">
      <Warp
        className="orbit-atmosphere-shader"
        colors={ORBIT_SHADER_COLORS}
        proportion={0.55}
        softness={1.5}
        distortion={0.18}
        swirl={0.88}
        swirlIterations={9}
        shape="edge"
        shapeScale={0.72}
        scale={0.95}
        rotation={18}
        speed={paused ? 0 : 0.42}
        minPixelRatio={1}
        maxPixelCount={2_073_600}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
