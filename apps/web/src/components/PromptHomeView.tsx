import { useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { Icon } from './Icon';
import { navigate } from '../router';
import { AppChromeHeader, SettingsIconButton, type ChromeTab } from './AppChromeHeader';
import { DesignsTab } from './DesignsTab';
import type { CreateInput, CreateTab } from './NewProjectPanel';
import type {
  DesignSystemSummary,
  Project,
  ProjectKind,
  ProjectMetadata,
  SkillSummary,
} from '../types';

type DictKey = keyof Dict;

const PENDING_SETUP_KEY = 'od:setup-pending';

const TAB_LABEL_KEYS: Record<CreateTab, DictKey> = {
  prototype: 'newproj.tabPrototype',
  'live-artifact': 'newproj.tabLiveArtifact',
  deck: 'newproj.tabDeck',
  template: 'newproj.tabTemplate',
  image: 'newproj.surfaceImage',
  video: 'newproj.surfaceVideo',
  audio: 'newproj.surfaceAudio',
  other: 'newproj.tabOther',
};

// Cross-page handshake: the home page sets this flag right before
// navigating into the freshly-created project so ProjectView knows to
// render the project setup form (locked NewProjectPanel) inside chat
// instead of auto-firing the prompt.
export function markPendingSetup(): void {
  try {
    window.sessionStorage.setItem(PENDING_SETUP_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumePendingSetup(): boolean {
  try {
    if (window.sessionStorage.getItem(PENDING_SETUP_KEY) !== '1') return false;
    window.sessionStorage.removeItem(PENDING_SETUP_KEY);
    return true;
  } catch {
    return false;
  }
}

interface Props {
  skills: SkillSummary[];
  designSystems: DesignSystemSummary[];
  projects: Project[];
  onCreateProject: (input: CreateInput & { pendingPrompt?: string }) => void;
  onOpenProject: (id: string) => void;
  onOpenLiveArtifact: (projectId: string, artifactId: string) => void;
  onDeleteProject: (id: string) => void;
  onOpenSettings: () => void;
  onImportClaudeDesign?: (file: File) => Promise<void> | void;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  // Browser-tab strip wiring forwarded into AppChromeHeader. Owned by
  // App.tsx so all three top-level views share the same open-tabs list.
  chromeTabs: ChromeTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function PromptHomeView({
  skills,
  designSystems,
  projects,
  onCreateProject,
  onOpenProject,
  onOpenLiveArtifact,
  onDeleteProject,
  onOpenSettings,
  onImportClaudeDesign,
  onImportFolder,
  chromeTabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
}: Props) {
  const t = useT();
  const [tab, setTab] = useState<CreateTab>('prototype');
  const [prompt, setPrompt] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [baseDir, setBaseDir] = useState('');
  const [importing, setImporting] = useState(false);
  const [importingFolder, setImportingFolder] = useState(false);
  const hasElectronPicker =
    typeof window !== 'undefined' && typeof window.electronAPI?.pickFolder === 'function';

  async function handleImportPicked(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !onImportClaudeDesign) return;
    setImporting(true);
    try {
      await onImportClaudeDesign(file);
    } finally {
      setImporting(false);
    }
  }

  async function handleOpenFolder() {
    if (!onImportFolder) return;
    let pathToOpen: string;
    if (hasElectronPicker) {
      const picked = await window.electronAPI!.pickFolder!();
      if (!picked) return;
      pathToOpen = picked;
    } else {
      const trimmed = baseDir.trim();
      if (!trimmed) return;
      pathToOpen = trimmed;
    }
    setImportingFolder(true);
    try {
      await onImportFolder(pathToOpen);
    } finally {
      setImportingFolder(false);
    }
  }

  // Default skill picked from the active tab so the per-mode SKILL.md
  // is composed into the system prompt. Mirrors NewProjectPanel.skillIdForTab.
  const skillIdForTab = useMemo(() => {
    if (tab === 'other') return null;
    if (tab === 'prototype') {
      const list = skills.filter((s) => s.mode === 'prototype');
      return list.find((s) => s.defaultFor.includes('prototype'))?.id
        ?? list[0]?.id
        ?? null;
    }
    if (tab === 'live-artifact') {
      const exact = skills.find(
        (s) => s.id === 'live-artifact' || s.name === 'live-artifact',
      );
      if (exact) return exact.id;
      const prototypes = skills.filter((s) => s.mode === 'prototype');
      return prototypes.find((s) => s.defaultFor.includes('prototype'))?.id
        ?? prototypes[0]?.id
        ?? null;
    }
    if (tab === 'deck') {
      const list = skills.filter((s) => s.mode === 'deck');
      return list.find((s) => s.defaultFor.includes('deck'))?.id
        ?? list[0]?.id
        ?? null;
    }
    if (tab === 'image' || tab === 'video' || tab === 'audio') {
      const list = skills.filter((s) => s.mode === tab || s.surface === tab);
      return list.find((s) => s.defaultFor.includes(tab))?.id
        ?? list[0]?.id
        ?? null;
    }
    return null;
  }, [tab, skills]);

  function defaultMetadata(forTab: CreateTab): ProjectMetadata {
    const kind: ProjectKind = forTab === 'live-artifact' ? 'prototype' : forTab;
    if (forTab === 'live-artifact') {
      return { kind, intent: 'live-artifact' as const };
    }
    return { kind };
  }

  function placeholderName(forTab: CreateTab): string {
    const stamp = new Date().toLocaleDateString();
    return `${t(TAB_LABEL_KEYS[forTab])} · ${stamp}`;
  }

  function handleSend() {
    const text = prompt.trim();
    if (!text) return;
    // Hand off to ProjectView via sessionStorage — the project gets a
    // placeholder name + minimal metadata here; the real choices
    // (设计体系/精度/演讲备注/媒体模型/…) are collected from the user
    // in chat once they land in the project.
    markPendingSetup();
    onCreateProject({
      name: placeholderName(tab),
      skillId: skillIdForTab,
      designSystemId: null,
      metadata: defaultMetadata(tab),
      pendingPrompt: text,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="od-prompt-home">
      <AppChromeHeader
        tabs={chromeTabs}
        activeTabId={activeTabId}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        actions={(
          <SettingsIconButton
            onClick={onOpenSettings}
            title={t('settings.kicker')}
            ariaLabel={t('settings.kicker')}
          />
        )}
      />

      <div className="od-prompt-home-main">
        <div className="od-prompt-home-tabs" role="tablist">
          {(Object.keys(TAB_LABEL_KEYS) as CreateTab[]).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={tab === entry}
              data-testid={`prompt-home-tab-${entry}`}
              className={`od-prompt-home-tab${tab === entry ? ' active' : ''}`}
              onClick={() => setTab(entry)}
            >
              {t(TAB_LABEL_KEYS[entry])}
            </button>
          ))}
          <button
            type="button"
            className="od-prompt-home-workspace"
            onClick={() => navigate({ kind: 'home' })}
            data-testid="prompt-home-open-workspace"
          >
            <Icon name="grid" size={14} />
            <span>{t('entry.tabDesigns')}</span>
          </button>
        </div>

        <div className="od-prompt-home-composer">
          <textarea
            className="od-prompt-home-input"
            data-testid="prompt-home-input"
            placeholder={t('chat.composerPlaceholder')}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={5}
          />
          <div className="od-prompt-home-composer-foot">
            <span className="od-prompt-home-hint">{t('chat.composerHint')}</span>
            <div className="od-prompt-home-foot-actions">
              {onImportClaudeDesign ? (
                <>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    hidden
                    onChange={handleImportPicked}
                  />
                  <button
                    type="button"
                    className="od-prompt-home-foot-icon"
                    data-testid="prompt-home-import-zip"
                    disabled={importing}
                    title={importing ? t('newproj.importingClaudeZip') : t('newproj.importClaudeZipTitle')}
                    aria-label={t('newproj.importClaudeZip')}
                    onClick={() => importInputRef.current?.click()}
                  >
                    <Icon name="import" size={14} />
                  </button>
                </>
              ) : null}
              {onImportFolder ? (
                <button
                  type="button"
                  className="od-prompt-home-foot-icon"
                  data-testid="prompt-home-open-folder"
                  disabled={(!hasElectronPicker && !baseDir.trim()) || importingFolder}
                  title={importingFolder ? 'Opening…' : 'Open folder'}
                  aria-label="Open folder"
                  onClick={() => void handleOpenFolder()}
                >
                  <Icon name="folder" size={14} />
                </button>
              ) : null}
              <button
                type="button"
                className="primary od-prompt-home-send"
                data-testid="prompt-home-send"
                onClick={handleSend}
                disabled={!prompt.trim()}
              >
                <Icon name="send" size={13} />
                <span>{t('chat.send')}</span>
              </button>
            </div>
          </div>
        </div>

        {projects.length > 0 ? (
          <div className="od-prompt-home-projects">
            <DesignsTab
              projects={projects}
              skills={skills}
              designSystems={designSystems}
              onOpen={onOpenProject}
              onOpenLiveArtifact={onOpenLiveArtifact}
              onDelete={onDeleteProject}
              hideSubTabs
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
