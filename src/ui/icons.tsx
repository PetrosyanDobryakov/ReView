/**
 * One icon hand (1.0): every glyph sits on a 24 grid, 1.75 stroke, 2px corner
 * radius on boxes, round caps and joins. One icon per meaning: sticky is a note,
 * file is a page, export leaves a tray, insert-image is a picture with a plus.
 */
export const ICON_PATHS = {
  select: 'M4.6 5.3a.6.6 0 0 1 .7-.7l14.2 5.8a.6.6 0 0 1-.05 1.13l-5.6 1.6a1.8 1.8 0 0 0-1.25 1.25l-1.6 5.6a.6.6 0 0 1-1.13.05z',
  pan: 'M7.5 12V6.5a1.5 1.5 0 0 1 3 0V11M10.5 11V4.5a1.5 1.5 0 0 1 3 0V11M13.5 11V5.5a1.5 1.5 0 0 1 3 0V12M16.5 12V8.5a1.5 1.5 0 0 1 3 0V14.5a6.5 6.5 0 0 1-6.5 6.5h-1a6.5 6.5 0 0 1-6.5-6.5V13a1.5 1.5 0 0 1 3 0v1',
  pen: 'M16.2 4.3a2.3 2.3 0 0 1 3.3 3.3L7.9 19.2 4 20l.8-3.9z',
  rect: 'M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z',
  ellipse: 'M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15z',
  sticky: 'M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7.2L14.2 19H7a2 2 0 0 1-2-2zM19 14.2h-3.3a1.5 1.5 0 0 0-1.5 1.5V19',
  text: 'M5.5 7.5V5.5h13v2M12 5.5v13M9.5 18.5h5',
  graph: 'M4 4v14a2 2 0 0 0 2 2h14M7.5 15.5c2-6 3.8-7.5 5.6-3.8s3.4 1.5 6-6.2',
  calculator:
    'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 7.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1zM8.8 13.5h.01M12 13.5h.01M15.2 13.5h.01M8.8 17h.01M12 17h.01M15.2 17h.01',
  table: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16',
  arrow: 'M5 12h14M13.5 6.5 19 12l-5.5 5.5',
  eraser:
    'M13.5 20H20M4.7 14.4l8.6-8.6a2 2 0 0 1 2.8 0l3.1 3.1a2 2 0 0 1 0 2.8L12 18.9a2 2 0 0 1-1.4.6H8.5a2 2 0 0 1-1.4-.6l-2.4-2.4a1.5 1.5 0 0 1 0-2.1zM9 10l6 6',
  lasso: 'M12 5c4.2 0 7.5 2.8 7.5 6.2S16.2 17.4 12 17.4 4.5 14.6 4.5 11.2 7.8 5 12 5z',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  fit: 'M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3',
  trash:
    'M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 11.6A2.5 2.5 0 0 0 9.8 21h4.4a2.5 2.5 0 0 0 2.5-2.4L17.5 7M10.2 11v6M13.8 11v6',
  copy: 'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  paste:
    'M9 4.5H7.5A2.5 2.5 0 0 0 5 7v11.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5H15M10 3h4a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
  duplicate:
    'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2M14 11v6M11 14h6',
  image:
    'M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM4.5 16.5l4.2-4.2a1.5 1.5 0 0 1 2.1 0l5.2 5.2M14 15l1.2-1.2a1.5 1.5 0 0 1 2.1 0l2.2 2.2M15.5 9h.01',
  insertImage:
    'M20 11.5V17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h5.5M4.5 17.5l4.2-4.2a1.5 1.5 0 0 1 2.1 0l5.2 5.2M14 15l1.2-1.2a1.5 1.5 0 0 1 2.1 0l2.4 2.4M18 3v6M15 6h6',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M18 6 6 18M6 6l12 12',
  noFill: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM6.5 6.5l11 11',
  person: 'M18 20v-1.5a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4V20M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  invite: 'M15 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  download: 'M12 4v10.5M7.5 10 12 14.5 16.5 10M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5',
  upload: 'M12 14.5V4M7.5 8.5 12 4l4.5 4.5M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5',
  export:
    'M12 14V3.5M8 7.5l4-4 4 4M8.5 10.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1.5',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v3.5A1.5 1.5 0 0 0 15.5 8H19M9 13h6M9 17h4',
  settings:
    'M10.15 5.04L10.43 2.83L13.57 2.83L13.85 5.04L15.61 5.77L17.37 4.41L19.59 6.63L18.23 8.39L18.96 10.15L21.17 10.43L21.17 13.57L18.96 13.85L18.23 15.61L19.59 17.37L17.37 19.59L15.61 18.23L13.85 18.96L13.57 21.17L10.43 21.17L10.15 18.96L8.39 18.23L6.63 19.59L4.41 17.37L5.77 15.61L5.04 13.85L2.83 13.57L2.83 10.43L5.04 10.15L5.77 8.39L4.41 6.63L6.63 4.41L8.39 5.77zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  home: 'M4 10.2a2 2 0 0 1 .7-1.5l6-5.2a2 2 0 0 1 2.6 0l6 5.2a2 2 0 0 1 .7 1.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM9.5 21v-4a2.5 2.5 0 0 1 5 0v4',
  // Text format glyphs use ICON_MULTI (multi-stroke Lucide paths).
  bold: '',
  italic: '',
  underline: '',
  strikethrough: '',
  highlight:
    'M9 11.5l-3.5 3.5a1 1 0 0 0 0 1.4l2.1 2.1a1 1 0 0 0 1.4 0l3.5-3.5M9 11.5l5.8-6.9a1.6 1.6 0 0 1 2.4-.1l2.3 2.3a1.6 1.6 0 0 1-.1 2.4L12.5 15M9 11.5l3.5 3.5M4 21h7',
  alignLeft: 'M4 4v16M8 8h12M8 12h8M8 16h12',
  alignCenterH: 'M12 4v16M6 8h12M7.5 12h9M6 16h12',
  alignRight: 'M20 4v16M4 8h12M8 12h8M4 16h12',
  alignTop: 'M4 4h16M8 8v12M12 8v8M16 8v12',
  alignCenterV: 'M4 12h16M8 6v12M12 7.5v9M16 6v12',
  alignBottom: 'M4 20h16M8 4v12M12 8v8M16 4v12',
  distributeH: 'M4 4v16M20 4v16M9.5 8h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
  distributeV: 'M4 4h16M4 20h16M8 9.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z',
  diamond: 'M10.6 3.9a2 2 0 0 1 2.8 0l6.7 6.7a2 2 0 0 1 0 2.8l-6.7 6.7a2 2 0 0 1-2.8 0l-6.7-6.7a2 2 0 0 1 0-2.8z',
  // Container with header bar — matches on-canvas frame (not a tiny org tree).
  frame: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 9h16',
  triangle: 'M10.3 4.9a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z',
  parallelogram: 'M8.4 5H19a1.5 1.5 0 0 1 1.4 2l-3.6 10.7a2 2 0 0 1-1.9 1.3H4.3a1.5 1.5 0 0 1-1.4-2L6.5 6.3A2 2 0 0 1 8.4 5z',
  hexagon: 'M8.6 3.5h6.8a2 2 0 0 1 1.7 1l3.9 6.5a2 2 0 0 1 0 2l-3.9 6.5a2 2 0 0 1-1.7 1H8.6a2 2 0 0 1-1.7-1L3 13a2 2 0 0 1 0-2l3.9-6.5a2 2 0 0 1 1.7-1z',
  cylinder: 'M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11M12 9.5c3.9 0 7-1.3 7-3s-3.1-3-7-3-7 1.3-7 3 3.1 3 7 3z',
  terminator: 'M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7z',
  subroutine: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 5v14M17 5v14',
  display: 'M5 5h8.6a2 2 0 0 1 1.6.8l4.3 5.4a1.3 1.3 0 0 1 0 1.6l-4.3 5.4a2 2 0 0 1-1.6.8H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  // Page stack (PageBar): closed top plate, open shelves.
  more: 'M12 3 3.5 7.5 12 12l8.5-4.5zM3.5 12 12 16.5 20.5 12M3.5 16.5 12 21l8.5-4.5',
  // Flowchart: top node + two branches (rects drawn separately in Icon).
  blockScheme: 'M12 6V10.5H4V14M12 10.5H20V14',
  // Toolbelt shapes slot: a box and a half moon.
  shapes: 'M4.5 11.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2zM16 3.5a4.5 4.5 0 1 1 0 9',
  // Insert shelf: plus inside soft corner marks.
  insert: 'M12 8v8M8 12h8M4 7V6a2 2 0 0 1 2-2h1M17 4h1a2 2 0 0 1 2 2v1M20 17v1a2 2 0 0 1-2 2h-1M7 20H6a2 2 0 0 1-2-2v-1',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  dotsH: 'M5 12h.01M12 12h.01M19 12h.01',
  warn: 'M10.3 4.9a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3zM12 10v3.5M12 16.8h.01',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  sparkles:
    'M10 5c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7zM18 2.5c.25 1.5.9 2.25 2.5 2.5-1.6.25-2.25 1-2.5 2.5-.25-1.5-.9-2.25-2.5-2.5 1.6-.25 2.25-1 2.5-2.5z',
  lock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 7.7-1.5',
  palette:
    'M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-2l-.3-1a2 2 0 0 1 1.9-2.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  keyboard: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0M12 19.5h.01',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  code: 'M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5',
} as const;

export type IconName = keyof typeof ICON_PATHS;

const ICON_MULTI: Partial<Record<IconName, readonly string[]>> = {
  bold: ['M6 12h9a4 4 0 0 0 0-8H6v8', 'M6 12h10a4 4 0 0 1 0 8H6v-8'],
  italic: ['M19 4L9 20', 'M4 20h10', 'M14 4h10'],
  underline: ['M6 4v6a6 6 0 0 0 12 0V4', 'M4 20h16'],
  strikethrough: ['M16 4H9a3 3 0 0 0-2.83 4', 'M14 12a4 4 0 0 1 0 8H6', 'M4 12h16'],
};

function iconPaths(name: IconName): readonly string[] {
  const multi = ICON_MULTI[name];
  if (multi) return multi;
  return [ICON_PATHS[name]];
}

export const TOOLBELT_ICON_SIZE = 22;
export const ICON_STROKE = 1.75;

/** Shared with tool cursors so the canvas pointer matches the toolbelt glyph. */
export const LASSO_HANDLE = 'M7.2 16.8c-1.3 2.2-2.9 3.8-3.6 3.8';
export const LASSO_NUDGE = [0.45, -0.8] as const;

/**
 * Translate glyphs so their ink sits in the center of the 24² viewBox (tool pill).
 * Lopsided glyphs (select arrow, eraser + baseline) split the difference between
 * box center and ink center of mass so they read centered.
 */
export const ICON_NUDGE: Partial<Record<IconName, readonly [number, number]>> = {
  select: [-0.2, -0.3],
  lasso: LASSO_NUDGE,
  pan: [-0.5, 0],
  eraser: [0, -0.3],
  sparkles: [0.25, 0.6],
  highlight: [0, -0.4],
  trash: [0, -0.25],
  export: [0, -0.25],
  parallelogram: [0.35, 0],
  display: [0.6, 0],
  invite: [-0.5, 0],
  insertImage: [-0.5, 0.5],
  shapes: [-0.5, 0],
};

function PathInk({ paths }: { paths: readonly string[] }) {
  return (
    <>
      {paths.map((d, i) => (
        <path key={i} d={d} pathLength={1} />
      ))}
    </>
  );
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const nudge = ICON_NUDGE[name];
  const body =
    name === 'blockScheme' ? (
      <>
        <rect x="9.5" y="2" width="5" height="4" rx="1" />
        <rect x="1.5" y="14" width="5" height="4" rx="1" />
        <rect x="17.5" y="14" width="5" height="4" rx="1" />
        <path d={ICON_PATHS.blockScheme} pathLength={1} />
      </>
    ) : (
      <>
        <PathInk paths={iconPaths(name)} />
        {name === 'lasso' ? <path d={LASSO_HANDLE} pathLength={1} /> : null}
      </>
    );

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'blockScheme' ? 1.5 : ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
      data-icon={name}
    >
      {nudge ? <g transform={`translate(${nudge[0]} ${nudge[1]})`}>{body}</g> : body}
    </svg>
  );
}
