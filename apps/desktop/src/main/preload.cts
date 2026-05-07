const { contextBridge, ipcRenderer } = require('electron');

// Keep this file dependency-free at runtime: in sandbox: true preloads only
// the `electron` module is safe to require. Channel names are duplicated from
// main/diagnostics.ts on purpose so the preload bundle does not pull in
// node-only modules transitively.
const DESKTOP_DIAGNOSTICS_IPC_CHANNEL = 'diagnostics:export-to-file';

type DesktopDiagnosticsExportResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:open-external', url),
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pick-folder'),
});

contextBridge.exposeInMainWorld('openDesignDesktop', {
  exportDiagnostics: (): Promise<DesktopDiagnosticsExportResult> =>
    ipcRenderer.invoke(DESKTOP_DIAGNOSTICS_IPC_CHANNEL) as Promise<DesktopDiagnosticsExportResult>,
});
