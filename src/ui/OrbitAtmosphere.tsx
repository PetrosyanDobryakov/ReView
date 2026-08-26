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

export function OrbitAtmosphere() {
  const [reduce, setReduce] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [visible, setVisible] = useState(() => typeof document !== 'undefined' && !document.hidden);

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => setReduce(mq.matches);
    mq.addEventListener('change', onMq);
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mq.removeEventListener('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const paused = reduce || !visible;

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
