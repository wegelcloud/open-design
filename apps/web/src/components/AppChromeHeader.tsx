import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { navigate } from '../router';

export interface ChromeTab {
  id: string;
  title: string;
}

interface Props {
  actions?: ReactNode;
  // Optional inline content rendered between the tab strip and the
  // actions. Most surfaces leave this empty now that tabs carry the
  // navigation state — kept for niche cases (e.g. ProjectView's
  // editable project title pill).
  children?: ReactNode;
  // Browser-tab style strip.
  tabs?: ChromeTab[];
  activeTabId?: string | null;
  // True when no project tab is selected (route is `/` or `/home`).
  // The home button is highlighted while this is true. Defaults to
  // `activeTabId == null` when omitted.
  homeActive?: boolean;
  onSelectTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onSelectHome?: () => void;
  // Legacy back-arrow path. Kept so callers that haven't migrated to
  // the tab strip yet still render an arrow next to the home button.
  onBack?: () => void;
  backLabel?: string;
}

export function AppChromeHeader({
  actions,
  children,
  tabs,
  activeTabId,
  homeActive,
  onSelectTab,
  onCloseTab,
  onSelectHome,
  onBack,
  backLabel,
}: Props) {
  const t = useT();
  const resolvedBackLabel = backLabel ?? t('project.backToProjects');
  const isHomeActive = homeActive ?? activeTabId == null;
  const homeLabel = t('entry.tabHome');

  function handleHomeClick() {
    if (onSelectHome) onSelectHome();
    else navigate({ kind: 'prompt-home' });
  }

  return (
    <header className="app-chrome-header">
      <div className="app-chrome-traffic-space" aria-hidden />
      <button
        type="button"
        className={`app-chrome-brand app-chrome-home${isHomeActive ? ' active' : ''}`}
        aria-label={homeLabel}
        title={homeLabel}
        onClick={handleHomeClick}
      >
        <span className="app-chrome-mark" aria-hidden>
          <Icon name="home" size={16} />
        </span>
        <span className="app-chrome-name">{homeLabel}</span>
      </button>
      {onBack ? (
        <button
          type="button"
          className="app-chrome-back"
          onClick={onBack}
          title={resolvedBackLabel}
          aria-label={resolvedBackLabel}
        >
          <Icon name="arrow-left" size={15} />
        </button>
      ) : null}
      {tabs && tabs.length > 0 ? (
        <div className="app-chrome-tabs" role="tablist">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`app-chrome-tab${isActive ? ' active' : ''}`}
                role="tab"
                aria-selected={isActive}
                data-testid={`chrome-tab-${tab.id}`}
              >
                <button
                  type="button"
                  className="app-chrome-tab-label"
                  onClick={() => onSelectTab?.(tab.id)}
                  title={tab.title}
                >
                  <Icon name="file" size={13} />
                  <span className="app-chrome-tab-title">{tab.title}</span>
                </button>
                {onCloseTab ? (
                  <button
                    type="button"
                    className="app-chrome-tab-close"
                    aria-label={`Close ${tab.title}`}
                    title={`Close ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {children ? <div className="app-chrome-content">{children}</div> : null}
      <div className="app-chrome-drag" aria-hidden />
      {actions ? <div className="app-chrome-actions">{actions}</div> : null}
    </header>
  );
}

export function SettingsIconButton({
  onClick,
  title,
  ariaLabel,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className="settings-icon-btn"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
    >
      <Icon name="settings" size={17} />
    </button>
  );
}
