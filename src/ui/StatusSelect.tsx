import type { BoardStatus } from '../core/boards';
import type { LocaleId } from '../core/locale';
import { ChromeSelect } from './ChromeSelect';
import { t } from './i18n';

const OPTIONS: BoardStatus[] = ['local', 'shared', 'remote'];

type StatusSelectProps = {
  value: BoardStatus;
  onChange: (value: BoardStatus) => void;
  locale: LocaleId;
  label: string;
};

function statusLabel(locale: LocaleId, value: BoardStatus): string {
  if (value === 'local') return t(locale, 'statusLocal');
  if (value === 'shared') return t(locale, 'statusShared');
  return t(locale, 'statusRemote');
}

export function StatusSelect({ value, onChange, locale, label }: StatusSelectProps) {
  return (
    <ChromeSelect
      className="status-select"
      value={value}
      fill
      size="sm"
      label={label}
      options={OPTIONS.map((option) => ({
        value: option,
        label: statusLabel(locale, option),
      }))}
      onChange={onChange}
    />
  );
}
