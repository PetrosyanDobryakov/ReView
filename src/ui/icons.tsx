export const ICON_PATHS = {
  select: 'M5 4l6.4 16.2 2.3-6.8 6.8-2.3L5 4z',
  pan: 'M8 12.5V6.5C8 5.67157 8.67157 5 9.5 5C10.3284 5 11 5.67157 11 6.5V11 M11 11V4.5C11 3.67157 11.6716 3 12.5 3C13.3284 3 14 3.67157 14 4.5V11 M14 11V5.5C14 4.67157 14.6716 4 15.5 4C16.3284 4 17 4.67157 17 5.5V12 M17 12V8.5C17 7.67157 17.6716 7 18.5 7C19.3284 7 20 7.67157 20 8.5V15C20 18.866 16.866 22 13 22H12C8.68629 22 6 19.3137 6 16V13.5C6 12.6716 6.67157 12 7.5 12C8.32843 12 9 12.6716 9 13.5V14.5',
  pen: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  rect: 'M5 5h14v14H5z',
  ellipse: 'M12 5a7 7 0 1 0 0 14 7 7 0 1 0 0-14z',
  sticky: 'M5 4h10l5 5v11H5zM15 4v5h5M8 13h8M8 17h5',
  text: 'M5 6h14M12 6v13',
  graph: 'M3 20c2.5-1 4-6.5 6-9s3 5 5 2 3.5-7 7-8M4 20h17',
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
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4',
  home: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  alignLeft: 'M3 4v16M7 8h13M7 12h10M7 16h13',
  alignCenterH: 'M12 4v16M6 8h12M5 12h14M6 16h12',
  alignRight: 'M21 4v16M4 8h13M7 12h10M4 16h13',
  alignTop: 'M4 3h16M8 7v11M12 7v8M16 7v11',
  alignCenterV: 'M4 12h16M8 6v7M12 5v14M16 6v7',
  alignBottom: 'M4 21h16M8 10v7M12 8v11M16 10v7',
  distributeH: 'M3 4v16M7 8h3v8H7zM14 8h3v8h-3zM3 12h16',
  distributeV: 'M4 3h16M8 7v3h8V7zM8 14v3h8v-3zM12 3v16',
  diamond: 'M12 3l9 9-9 9-9-9z',
  // Container with header bar — matches on-canvas frame (not a tiny org tree).
  frame: 'M4 4h16v16H4zM4 9h16',
  triangle: 'M12 3l10 17H2z',
  parallelogram: 'M7 5h12l-4 14H2z',
  hexagon: 'M8 3h8l6 9-6 9H8l-6-9z',
  cylinder: 'M5 6h14v8a7 3 0 0 1-14 0V6zM5 6a7 3 0 0 1 14 0M5 14a7 3 0 0 1 14 0',
  terminator: 'M6 8h12a6 6 0 0 1 0 12H6a6 6 0 0 1 0-12z',
  subroutine: 'M3 5h18v14H3zM7 5v14M17 5v14',
  display: 'M3 5h11l5 7-5 7H3z',
  // Evenly spaced layers — closed top plate, open shelves (no stem).
  more: 'M12 2.5l8 4-8 4-8-4zM4 12.5l8 4 8-4M4 17.5l8 4 8-4',
  // Two stacked process boxes + connector.
  blockScheme: 'M7 3.5h10v6H7zM12 9.5v3M7 12.5h10v6H7z',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export const TOOLBELT_ICON_SIZE = 22;

const LASSO_HANDLE = 'M7.2 16.8c-1.3 2.2-2.9 3.8-3.6 3.8';
const HOME_DOOR = 'M9 21v-8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v8';
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
          {name === 'home' ? <path d={HOME_DOOR} /> : null}
        </>
      )}
    </svg>
  );
}
