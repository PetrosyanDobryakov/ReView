import type { LocaleId } from '../core/locale';
import { t } from './i18n';
import { Icon } from './icons';

type JoinSavePromptProps = {
  locale: LocaleId;
  onKeepOnDevice: () => void;
  onSaveAsMyBoard: () => void;
  onLater: () => void;
};

export function JoinSavePrompt({ locale, onKeepOnDevice, onSaveAsMyBoard, onLater }: JoinSavePromptProps) {
  return (
    <div className="join-prompt-root" role="dialog" aria-modal="true" aria-labelledby="join-save-title">
      <div className="join-prompt-backdrop" aria-hidden="true" />
      <div className="join-prompt">
        <div className="join-prompt-head">
          <b id="join-save-title">{t(locale, 'joinSaveTitle')}</b>
          <button
            type="button"
            className="icon-btn"
            title={t(locale, 'close')}
            aria-label={t(locale, 'close')}
            onClick={onLater}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="join-prompt-hint">{t(locale, 'joinSaveHint')}</p>
        <div className="join-prompt-actions">
          <button type="button" className="style-btn active" title={t(locale, 'keepOnDeviceHint')} onClick={onKeepOnDevice}>
            {t(locale, 'keepOnDevice')}
          </button>
          <button type="button" className="style-btn" title={t(locale, 'saveAsMyBoardHint')} onClick={onSaveAsMyBoard}>
            {t(locale, 'saveAsMyBoard')}
          </button>
          <button type="button" className="join-prompt-later" onClick={onLater}>
            {t(locale, 'joinSaveLater')}
          </button>
        </div>
      </div>
    </div>
  );
}
