/* eslint-disable i18next/no-literal-string */
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SWRConfig } from 'swr';

export interface IPageSettings {
  refreshInterval?: number;
  theme?: 'system' | 'light' | 'dark';
  activeTheme?: 'light' | 'dark';
  tableLayout?: 'compact' | 'comfortable';
  formColumns?: 'single' | 'multiple';
  formLayout?: 'vertical' | 'horizontal';
  dateFormat?: 'since' | 'date-time';
  dataEditorFormat?: 'yaml' | 'json';
}

type PageSettingsRemoteSave = (settings: IPageSettings) => void | Promise<void>;

type PageSettingsContextValue = [
  IPageSettings,
  (settings: IPageSettings) => void,
  (
    userId: string | null,
    serverSettings?: IPageSettings,
    saveSettings?: PageSettingsRemoteSave
  ) => void,
];

export const PageSettingsContext = createContext<PageSettingsContextValue>([
  {},
  () => null,
  () => null,
]);

export function usePageSettings() {
  const [settings] = useContext(PageSettingsContext);
  return settings;
}

/** Switch the active user so settings are loaded from / saved to a user-specific key. */
export function usePageSettingsSwitchUser() {
  const [, , switchUser] = useContext(PageSettingsContext);
  return switchUser;
}

const DEFAULT_STORAGE_KEY = 'user-preferences';

function loadSettings(
  key: string,
  defaultRefreshInterval: number,
  serverSettings?: IPageSettings
): IPageSettings {
  let stored: IPageSettings = {};
  try {
    const raw = localStorage.getItem(key);
    if (raw) stored = JSON.parse(raw) as IPageSettings;
  } catch {
    // ignore
  }
  return {
    refreshInterval: defaultRefreshInterval,
    theme: 'system',
    tableLayout: 'comfortable',
    formColumns: 'multiple',
    formLayout: 'vertical',
    dateFormat: 'date-time',
    dataEditorFormat: 'yaml',
    ...stored,
    ...serverSettings,
  };
}

export function PageSettingsProvider(props: {
  children?: ReactNode;
  defaultRefreshInterval: number;
}) {
  const storageKeyRef = useRef<string>(DEFAULT_STORAGE_KEY);
  const saveSettingsRef = useRef<PageSettingsRemoteSave | undefined>(undefined);
  const [settings, setSettingsState] = useState<IPageSettings>(() =>
    loadSettings(DEFAULT_STORAGE_KEY, props.defaultRefreshInterval)
  );

  const setSettings = useCallback((settings: IPageSettings) => {
    localStorage.setItem(storageKeyRef.current, JSON.stringify(settings));
    setSettingsState(settings);
    void Promise.resolve(saveSettingsRef.current?.(settings)).catch(() => undefined);
  }, []);

  const switchUser = useCallback(
    (
      userId: string | null,
      serverSettings?: IPageSettings,
      saveSettings?: PageSettingsRemoteSave
    ) => {
      const key = userId ? `user-preferences-${userId}` : DEFAULT_STORAGE_KEY;
      storageKeyRef.current = key;
      saveSettingsRef.current = saveSettings;
      setSettingsState(loadSettings(key, props.defaultRefreshInterval, serverSettings));
    },
    [props.defaultRefreshInterval]
  );

  const activeTheme = useMemo(() => {
    return settings.theme !== 'light' && settings.theme !== 'dark'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    setSettingsState((settings) => {
      if (settings.activeTheme === activeTheme) return settings;
      return { ...settings, activeTheme };
    });
    if (activeTheme === 'dark') {
      document.documentElement.classList.add('pf-v5-theme-dark');
    } else {
      document.documentElement.classList.remove('pf-v5-theme-dark');
    }
  }, [activeTheme]);

  return (
    <SWRConfig
      value={{ refreshInterval: settings.refreshInterval ? settings.refreshInterval * 1000 : 0 }}
    >
      <PageSettingsContext.Provider value={[settings, setSettings, switchUser]}>
        {props.children}
      </PageSettingsContext.Provider>
    </SWRConfig>
  );
}
