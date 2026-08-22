import type { ToolId } from '../engine/tools';

export function Icon({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS: Record<ToolId, string> = {
  select: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z M13 13l6 6',
  pan: 'M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  pen: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  rect: 'M4 4h16v16H4z',
  ellipse: 'M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z',
  sticky: 'M4 4h12l4 4v12H4z M16 4v4h4',
  text: 'M5 5h14M12 5v14',
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  eraser: 'M19 20H10 M10 4l6 6-8.5 8.5a2 2 0 0 1-2.83 0L3.4 11.4a2 2 0 0 1 0-2.83L10 4z',
  lasso: 'M7 22a5 5 0 0 1-2-4 M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1 M5 13a0 0 0 0 0 0 0',
};

const TOOLS: Array<{ id: ToolId; label: string }> = [
  { id: 'select', label: 'Выделение (V)' },
  { id: 'lasso', label: 'Ласо — выделение произвольной областью' },
  { id: 'pan', label: 'Рука — пробел' },
  { id: 'pen', label: 'Маркер (P)' },
  { id: 'eraser', label: 'Ластик (E)' },
  { id: 'rect', label: 'Прямоугольник (R)' },
  { id: 'ellipse', label: 'Эллипс (O)' },
  { id: 'arrow', label: 'Стрелка (L)' },
  { id: 'sticky', label: 'Стикер (S)' },
  { id: 'text', label: 'Текст (T)' },
];

export interface ToolbarProps {
  tool: ToolId;
  selectionCount: number;
  onTool: (id: ToolId) => void;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function Toolbar({
  tool,
  selectionCount,
  onTool,
  onDelete,
  onCopy,
  onPaste,
  onDuplicate,
  onUndo,
  onRedo,
}: ToolbarProps) {
  return (
    <aside className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn${tool === t.id ? ' active' : ''}`}
          title={t.label}
          onClick={() => onTool(t.id)}
        >
          <Icon d={ICONS[t.id]} />
        </button>
      ))}
      <div className="toolbar-sep" />
      <button className="tool-btn" title="Удалить (Del)" disabled={!selectionCount} onClick={onDelete}>
        <Icon d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6" />
      </button>
      <button className="tool-btn" title="Копировать (Ctrl+C)" disabled={!selectionCount} onClick={onCopy}>
        <Icon d="M8 8h12v12H8z M4 16V4h12" />
      </button>
      <button className="tool-btn" title="Вставить (Ctrl+V)" onClick={onPaste}>
        <Icon d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z" />
      </button>
      <button className="tool-btn" title="Дублировать (Ctrl+D)" disabled={!selectionCount} onClick={onDuplicate}>
        <Icon d="M8 8h12v12H8z M4 16V4h12 M15 11v6 M12 14h6" />
      </button>
      <button className="tool-btn" title="Отменить (Ctrl+Z)" onClick={onUndo}>
        <Icon d="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13" />
      </button>
      <button className="tool-btn" title="Повторить (Ctrl+Y)" onClick={onRedo}>
        <Icon d="M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13" />
      </button>
    </aside>
  );
}
