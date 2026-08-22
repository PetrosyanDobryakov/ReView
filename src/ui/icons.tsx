export const ICON_PATHS = {
  select: 'M5 4l6.4 16.2 2.3-6.8 6.8-2.3L5 4z',
  pan: 'M8 12.5V6.5C8 5.67157 8.67157 5 9.5 5C10.3284 5 11 5.67157 11 6.5V11 M11 11V4.5C11 3.67157 11.6716 3 12.5 3C13.3284 3 14 3.67157 14 4.5V11 M14 11V5.5C14 4.67157 14.6716 4 15.5 4C16.3284 4 17 4.67157 17 5.5V12 M17 12V8.5C17 7.67157 17.6716 7 18.5 7C19.3284 7 20 7.67157 20 8.5V15C20 18.866 16.866 22 13 22H12C8.68629 22 6 19.3137 6 16V13.5C6 12.6716 6.67157 12 7.5 12C8.32843 12 9 12.6716 9 13.5V14.5',
  pen: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  rect: 'M5 5h14v14H5z',
  ellipse: 'M12 5a7 7 0 1 0 0 14 7 7 0 1 0 0-14z',
  sticky: 'M5 4h10l5 5v11H5zM15 4v5h5M8 13h8M8 17h5',
  text: 'M5 6h14M12 6v13',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  eraser: 'M3 16.5l5.5 5.5 13-13-5.5-5.5zM10 22h11',
  lasso: 'M12 5c4.2 0 7.5 2.8 7.5 6.2S16.2 17.4 12 17.4 4.5 14.6 4.5 11.2 7.8 5 12 5z',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
  redo: 'M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
  trash: 'M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  paste:
    'M9 4h6v3H9zM8 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1',
  duplicate: 'M8 8h11v11H8zM5 16V5h11M13.5 12v5M11 14.5h5',
  image: 'M5 6h14v12H5zM5 15l4.5-4.5 3.5 3.5 2.5-2.5L19 16',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  check: 'M5 12l5 5L20 7',
  close: 'M18 6L6 18M6 6l12 12',
  person: 'M18 21v-2a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export const TOOLBELT_ICON_SIZE = 22;

const LASSO_HANDLE = 'M7.2 16.8c-1.3 2.2-2.9 3.8-3.6 3.8';
const PAN_FIT = 'translate(12 12) scale(0.88) translate(-13 -12.5)';
const PEN_FIT = 'translate(12 12) scale(0.86) translate(-12 -12)';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'pan' ? 1.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
    >
      {name === 'pan' ? (
        <g transform={PAN_FIT}>
          <path d={ICON_PATHS.pan} />
        </g>
      ) : name === 'pen' ? (
        <g transform={PEN_FIT}>
          <path d={ICON_PATHS.pen} />
        </g>
      ) : (
        <>
          <path d={ICON_PATHS[name]} strokeDasharray={name === 'lasso' ? '3.25 2.7' : undefined} />
          {name === 'lasso' ? <path d={LASSO_HANDLE} /> : null}
        </>
      )}
    </svg>
  );
}
