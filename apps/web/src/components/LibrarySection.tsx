import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import type { AppConfig } from '../types';
import type { SkillSummary, DesignSystemSummary } from '@open-design/contracts';
import {
  deleteSkill,
  fetchSkills,
  fetchDesignSystems,
  fetchSkill,
  fetchDesignSystem,
  importSkill,
} from '../providers/registry';

type Tab = 'skills' | 'design-systems';

interface Props {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
}

const MODES = [
  'prototype',
  'deck',
  'template',
  'design-system',
  'image',
  'video',
  'audio',
] as const;

export function LibrarySection({ cfg, setCfg }: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('skills');
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [designSystems, setDesignSystems] = useState<DesignSystemSummary[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Inline "Import skill" form state. The form is intentionally minimal —
  // `name` is the SKILL.md `name` (and the slug we write under user-skills/),
  // `body` is everything below the front-matter. Triggers get auto-split
  // on commas / newlines.
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState('');
  const [importDescription, setImportDescription] = useState('');
  const [importTriggers, setImportTriggers] = useState('');
  const [importBody, setImportBody] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const refreshSkills = useCallback(async () => {
    const list = await fetchSkills();
    setSkills(list);
    return list;
  }, []);

  useEffect(() => {
    void refreshSkills();
    fetchDesignSystems().then(setDesignSystems);
  }, [refreshSkills]);

  const categories = useMemo(() => {
    const cats = new Set(designSystems.map((d) => d.category));
    return ['All', ...Array.from(cats).sort()];
  }, [designSystems]);

  const disabledSkills = useMemo(
    () => new Set(cfg.disabledSkills ?? []),
    [cfg.disabledSkills],
  );
  const disabledDS = useMemo(
    () => new Set(cfg.disabledDesignSystems ?? []),
    [cfg.disabledDesignSystems],
  );

  const filteredSkills = useMemo(() => {
    const q = search.toLowerCase();
    return skills.filter((s) => {
      if (modeFilter !== 'all' && s.mode !== modeFilter) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [skills, modeFilter, search]);

  const filteredDS = useMemo(() => {
    const q = search.toLowerCase();
    return designSystems.filter((d) => {
      if (categoryFilter !== 'All' && d.category !== categoryFilter) return false;
      if (q && !d.title.toLowerCase().includes(q) && !d.summary.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [designSystems, categoryFilter, search]);

  const groupedSkills = useMemo(() => {
    const groups = new Map<string, SkillSummary[]>();
    for (const s of filteredSkills) {
      const list = groups.get(s.mode) ?? [];
      list.push(s);
      groups.set(s.mode, list);
    }
    return groups;
  }, [filteredSkills]);

  const groupedDS = useMemo(() => {
    const groups = new Map<string, DesignSystemSummary[]>();
    for (const d of filteredDS) {
      const list = groups.get(d.category) ?? [];
      list.push(d);
      groups.set(d.category, list);
    }
    return groups;
  }, [filteredDS]);

  const openPreview = useCallback(
    async (id: string) => {
      if (previewId === id) {
        setPreviewId(null);
        setPreviewBody(null);
        return;
      }
      setPreviewId(id);
      setPreviewBody(null);
      setPreviewLoading(true);
      try {
        const detail =
          tab === 'skills'
            ? await fetchSkill(id)
            : await fetchDesignSystem(id);
        setPreviewId((cur) => {
          if (cur === id) setPreviewBody(detail?.body ?? null);
          return cur;
        });
      } catch {
        setPreviewId((cur) => {
          if (cur === id) setPreviewBody(null);
          return cur;
        });
      } finally {
        setPreviewId((cur) => {
          if (cur === id) setPreviewLoading(false);
          return cur;
        });
      }
    },
    [previewId, tab],
  );

  function resetImportForm() {
    setImportName('');
    setImportDescription('');
    setImportTriggers('');
    setImportBody('');
    setImportError(null);
  }

  async function handleImportSubmit() {
    if (importing) return;
    const name = importName.trim();
    const body = importBody.trim();
    if (!name) {
      setImportError('Skill name is required.');
      return;
    }
    if (!body) {
      setImportError('Skill body is required.');
      return;
    }
    const triggers = importTriggers
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    setImporting(true);
    setImportError(null);
    const result = await importSkill({
      name,
      description: importDescription.trim() || undefined,
      body,
      triggers,
    });
    setImporting(false);
    if ('error' in result) {
      setImportError(result.error.message);
      return;
    }
    await refreshSkills();
    resetImportForm();
    setImportOpen(false);
  }

  async function handleDeleteSkill(id: string) {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Delete skill "${id}"? This cannot be undone.`);
      if (!ok) return;
    }
    const result = await deleteSkill(id);
    if ('error' in result) {
      setImportError(result.error.message);
      return;
    }
    await refreshSkills();
    setCfg((c) => {
      const set = new Set(c.disabledSkills ?? []);
      set.delete(id);
      return { ...c, disabledSkills: [...set] };
    });
    if (previewId === id) {
      setPreviewId(null);
      setPreviewBody(null);
    }
  }

  function toggleSkillDisabled(id: string, disabled: boolean) {
    setCfg((c) => {
      const set = new Set(c.disabledSkills ?? []);
      if (disabled) set.add(id);
      else set.delete(id);
      return { ...c, disabledSkills: [...set] };
    });
  }

  function toggleDSDisabled(id: string, disabled: boolean) {
    setCfg((c) => {
      const set = new Set(c.disabledDesignSystems ?? []);
      if (disabled) set.add(id);
      else set.delete(id);
      return { ...c, disabledDesignSystems: [...set] };
    });
  }

  return (
    <section className="settings-section">
      <div className="section-head">
        <div>
          <h3>{t('settings.library')}</h3>
          <p className="hint">{t('settings.libraryHint')}</p>
        </div>
      </div>

      <div className="seg-control" role="tablist">
        <button
          type="button"
          role="tab"
          className={`seg-btn${tab === 'skills' ? ' active' : ''}`}
          onClick={() => {
            setTab('skills');
            setModeFilter('all');
            setCategoryFilter('All');
            setSearch('');
            setPreviewId(null);
          }}
        >
          <span className="seg-title">
            {t('settings.librarySkills')}
            <span className="seg-meta">{skills.length}</span>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          className={`seg-btn${tab === 'design-systems' ? ' active' : ''}`}
          onClick={() => {
            setTab('design-systems');
            setModeFilter('all');
            setCategoryFilter('All');
            setSearch('');
            setPreviewId(null);
          }}
        >
          <span className="seg-title">
            {t('settings.libraryDesignSystems')}
            <span className="seg-meta">{designSystems.length}</span>
          </span>
        </button>
      </div>

      <div className="library-toolbar">
        <input
          type="search"
          className="library-search"
          placeholder={t('settings.librarySearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {tab === 'skills' ? (
          <button
            type="button"
            className={`filter-pill library-import-toggle${importOpen ? ' active' : ''}`}
            onClick={() => {
              setImportOpen((open) => {
                if (open) resetImportForm();
                return !open;
              });
            }}
            data-testid="library-import-toggle"
          >
            <Icon name="upload" size={12} />
            <span>Import skill</span>
          </button>
        ) : null}
        {tab === 'skills' ? (
          <div className="library-filters">
            <button
              type="button"
              className={`filter-pill${modeFilter === 'all' ? ' active' : ''}`}
              onClick={() => setModeFilter('all')}
            >
              {t('settings.libraryAll')}
            </button>
            {MODES.map((mode) => {
              const count = skills.filter((s) => s.mode === mode).length;
              if (count === 0) return null;
              return (
                <button
                  key={mode}
                  type="button"
                  className={`filter-pill${modeFilter === mode ? ' active' : ''}`}
                  onClick={() => setModeFilter(mode)}
                >
                  {mode}
                  <span className="filter-pill-count">{count}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="library-filters">
            {categories.map((cat) => {
              const count =
                cat === 'All'
                  ? designSystems.length
                  : designSystems.filter((d) => d.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  className={`filter-pill${categoryFilter === cat ? ' active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat}
                  <span className="filter-pill-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {tab === 'skills' && importOpen ? (
        <div className="library-import-form" data-testid="library-import-form">
          <div className="library-import-row">
            <label>
              <span>Name</span>
              <input
                type="text"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="my-skill"
              />
            </label>
            <label>
              <span>Triggers (comma- or newline-separated)</span>
              <input
                type="text"
                value={importTriggers}
                onChange={(e) => setImportTriggers(e.target.value)}
                placeholder="search the web, summarize"
              />
            </label>
          </div>
          <label className="library-import-block">
            <span>Description</span>
            <textarea
              rows={2}
              value={importDescription}
              onChange={(e) => setImportDescription(e.target.value)}
              placeholder="What does this skill do? When should the agent reach for it?"
            />
          </label>
          <label className="library-import-block">
            <span>SKILL.md body</span>
            <textarea
              rows={8}
              value={importBody}
              onChange={(e) => setImportBody(e.target.value)}
              placeholder="# My skill\n\n1. Explain the workflow.\n2. Describe the inputs and outputs."
            />
          </label>
          {importError ? (
            <div className="library-import-error" role="alert">
              {importError}
            </div>
          ) : null}
          <div className="library-import-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                resetImportForm();
                setImportOpen(false);
              }}
              disabled={importing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleImportSubmit()}
              disabled={importing}
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="library-content">
        {tab === 'skills' ? (
          filteredSkills.length === 0 ? (
            <p className="library-empty">{t('settings.libraryNoResults')}</p>
          ) : (
            MODES.filter((m) => groupedSkills.has(m)).map((mode) => (
              <div key={mode} className="library-group">
                <h4 className="library-group-title">
                  {mode}{' '}
                  <span className="library-group-count">{groupedSkills.get(mode)!.length}</span>
                </h4>
                {groupedSkills.get(mode)!.map((skill) => (
                  <div
                    key={skill.id}
                    className={`library-card${disabledSkills.has(skill.id) ? ' disabled' : ''}`}
                  >
                    <div className="library-card-info">
                      <div className="library-card-title-row">
                        <span className="library-card-name">{skill.name}</span>
                        <span className="library-card-badge">{skill.previewType}</span>
                        {skill.source === 'user' ? (
                          <span
                            className="library-card-badge library-card-badge-user"
                            title="User-imported skill"
                          >
                            user
                          </span>
                        ) : null}
                      </div>
                      <div className="library-card-desc">{skill.description}</div>
                    </div>
                    <button
                      type="button"
                      className="library-card-expand"
                      onClick={() => openPreview(skill.id)}
                      title={t('settings.libraryPreview')}
                    >
                      <Icon
                        name={previewId === skill.id ? 'close' : 'chevron-right'}
                        size={14}
                      />
                    </button>
                    {skill.source === 'user' ? (
                      <button
                        type="button"
                        className="library-card-delete"
                        onClick={() => void handleDeleteSkill(skill.id)}
                        title="Delete this user skill"
                        aria-label={`Delete user skill ${skill.id}`}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    ) : null}
                    <label className="toggle-switch" title={t('settings.libraryToggleLabel')}>
                      <input
                        type="checkbox"
                        checked={!disabledSkills.has(skill.id)}
                        onChange={(e) => toggleSkillDisabled(skill.id, !e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </label>
                    {previewId === skill.id && (
                      <div className="library-preview">
                        {previewLoading ? (
                          <p>{t('settings.libraryLoading')}</p>
                        ) : previewBody ? (
                          <pre className="library-preview-body">{previewBody}</pre>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )
        ) : filteredDS.length === 0 ? (
          <p className="library-empty">{t('settings.libraryNoResults')}</p>
        ) : (
          <>
            {Array.from(groupedDS.entries()).map(([category, items]) => (
              <div key={category} className="library-group">
                <h4 className="library-group-title">
                  {category} <span className="library-group-count">{items.length}</span>
                </h4>
                <div className="ds-grid">
                  {items.map((ds) => (
                    <div
                      key={ds.id}
                      className={`library-ds-card${disabledDS.has(ds.id) ? ' disabled' : ''}`}
                    >
                      <div className="library-ds-card-content" onClick={() => openPreview(ds.id)}>
                        {ds.swatches && ds.swatches.length > 0 && (
                          <div className="library-ds-swatches">
                            {ds.swatches.slice(0, 4).map((c, i) => (
                              <span
                                key={i}
                                className="library-ds-swatch"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        )}
                        <div className="library-ds-title">{ds.title}</div>
                        <div className="library-ds-summary">{ds.summary}</div>
                      </div>
                      <label className="toggle-switch toggle-switch-sm" title={t('settings.libraryToggleLabel')}>
                        <input
                          type="checkbox"
                          checked={!disabledDS.has(ds.id)}
                          onChange={(e) => toggleDSDisabled(ds.id, !e.target.checked)}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {previewId && filteredDS.some((d) => d.id === previewId) && (
              <div className="library-preview">
                {previewLoading ? (
                  <p>{t('settings.libraryLoading')}</p>
                ) : previewBody ? (
                  <pre className="library-preview-body">{previewBody}</pre>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
