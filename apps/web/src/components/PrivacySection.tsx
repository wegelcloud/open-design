import type { Dispatch, SetStateAction } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import type { AppConfig, TelemetryConfig } from '../types';

interface Props {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
}

function generateInstallationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older test runners,
  // some embedded webviews). Not cryptographically strong but sufficient
  // for an opaque, non-PII install identifier.
  return `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PrivacySection({ cfg, setCfg }: Props): JSX.Element {
  const t = useT();
  const telemetry: TelemetryConfig = cfg.telemetry ?? {};
  // `installationId === undefined` means the user has never seen the consent
  // surface. After the first decision it's either a uuid (opted in) or
  // `null` (declined). We use that to gate the welcome banner vs the regular
  // toggle row.
  const hasMadeConsentDecision = cfg.installationId !== undefined;

  function patchTelemetry(patch: Partial<TelemetryConfig>): void {
    setCfg((c) => ({ ...c, telemetry: { ...(c.telemetry ?? {}), ...patch } }));
  }

  function shareUsage(): void {
    setCfg((c) => ({
      ...c,
      installationId: generateInstallationId(),
      telemetry: { metrics: true, content: true, artifactManifest: false },
    }));
  }

  function declineUsage(): void {
    setCfg((c) => ({
      ...c,
      installationId: null,
      telemetry: { metrics: false, content: false, artifactManifest: false },
    }));
  }

  function rotateInstallationId(): void {
    setCfg((c) => ({
      ...c,
      installationId: null,
      telemetry: { metrics: false, content: false, artifactManifest: false },
    }));
  }

  return (
    <section className="settings-section settings-privacy">
      <div className="section-head">
        <div>
          <h3>{t('settings.privacy')}</h3>
          <p className="hint">{t('settings.privacyHint')}</p>
        </div>
      </div>

      {!hasMadeConsentDecision ? (
        <div className="settings-privacy-consent">
          <div className="settings-privacy-consent-body">
            <strong>{t('settings.privacyConsentKicker')}</strong>
            <p>{t('settings.privacyConsentLead')}</p>
            <ul>
              <li>
                <strong>{t('settings.privacyMetrics')}</strong>
                <span>{t('settings.privacyMetricsHint')}</span>
              </li>
              <li>
                <strong>{t('settings.privacyContent')}</strong>
                <span>{t('settings.privacyContentHint')}</span>
              </li>
            </ul>
            <p className="hint">{t('settings.privacyConsentFooter')}</p>
          </div>
          <div className="settings-privacy-consent-actions">
            <button
              type="button"
              className="settings-privacy-consent-share"
              onClick={shareUsage}
            >
              {t('settings.privacyConsentShare')}
            </button>
            <button
              type="button"
              className="settings-privacy-consent-decline"
              onClick={declineUsage}
            >
              {t('settings.privacyConsentDecline')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-privacy-toggles">
            <PrivacyToggle
              label={t('settings.privacyMetrics')}
              hint={t('settings.privacyMetricsHint')}
              checked={telemetry.metrics === true}
              onChange={(v) => patchTelemetry({ metrics: v })}
            />
            <PrivacyToggle
              label={t('settings.privacyContent')}
              hint={t('settings.privacyContentHint')}
              checked={telemetry.content === true}
              onChange={(v) => patchTelemetry({ content: v })}
            />
            <PrivacyToggle
              label={t('settings.privacyArtifacts')}
              hint={t('settings.privacyArtifactsHint')}
              checked={telemetry.artifactManifest === true}
              onChange={(v) => patchTelemetry({ artifactManifest: v })}
            />
          </div>

          <dl className="settings-privacy-id">
            <div>
              <dt>{t('settings.privacyInstallationId')}</dt>
              <dd>
                <code>{cfg.installationId ?? t('settings.privacyOptedOut')}</code>
              </dd>
            </div>
          </dl>

          <div className="settings-privacy-actions">
            <button
              type="button"
              className="settings-privacy-delete"
              onClick={rotateInstallationId}
            >
              <Icon name="refresh" size={14} />
              <span>{t('settings.privacyDataDeletion')}</span>
            </button>
            <p className="hint">{t('settings.privacyDataDeletionHint')}</p>
          </div>
        </>
      )}
    </section>
  );
}

interface ToggleProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function PrivacyToggle({ label, hint, checked, onChange }: ToggleProps): JSX.Element {
  return (
    <label className="settings-privacy-toggle">
      <span className="settings-privacy-toggle-text">
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
