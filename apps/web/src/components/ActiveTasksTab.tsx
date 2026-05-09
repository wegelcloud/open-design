import { useMemo } from 'react';
import { useT } from '../i18n';
import type { Project, ProjectDisplayStatus } from '../types';
import { STATUS_LABEL_KEYS } from './DesignsTab';

interface Props {
  projects: Project[];
  onOpen: (id: string) => void;
}

const ACTIVE_STATUSES: readonly ProjectDisplayStatus[] = [
  'running',
  'queued',
  'awaiting_input',
];

export function ActiveTasksTab({ projects, onOpen }: Props) {
  const t = useT();

  const active = useMemo(() => {
    return projects
      .filter((p) => {
        const value = p.status?.value;
        return value ? ACTIVE_STATUSES.includes(value) : false;
      })
      .sort((a, b) => {
        const aTs = a.status?.updatedAt ?? a.updatedAt;
        const bTs = b.status?.updatedAt ?? b.updatedAt;
        return bTs - aTs;
      });
  }, [projects]);

  if (active.length === 0) {
    return <div className="tab-empty">{t('activeTasks.empty')}</div>;
  }

  return (
    <div className="design-grid">
      {active.map((p) => {
        const status = p.status?.value ?? 'not_started';
        const ts = p.status?.updatedAt ?? p.updatedAt;
        return (
          <div
            key={p.id}
            className="design-card"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(p.id);
              }
            }}
            aria-label={t('activeTasks.openProjectAria', { name: p.name })}
          >
            <div className="design-card-thumb" aria-hidden />
            <div className="design-card-meta-block">
              <div className="design-card-name" title={p.name}>
                {p.name}
              </div>
              <div className="design-card-meta">
                <span className={`design-card-status design-card-status-${status}`}>
                  {t(STATUS_LABEL_KEYS[status])}
                </span>
                {' · '}
                {relativeTime(ts, t)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function relativeTime(ts: number, t: ReturnType<typeof useT>): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t('common.justNow');
  if (diff < hr) return t('common.minutesAgo', { n: Math.floor(diff / min) });
  if (diff < day) return t('common.hoursAgo', { n: Math.floor(diff / hr) });
  if (diff < 7 * day) return t('common.daysAgo', { n: Math.floor(diff / day) });
  return new Date(ts).toLocaleDateString();
}
