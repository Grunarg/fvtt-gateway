// Vite/Forge Magic Constants
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// ─── Konfigurationstypen ──────────────────────────────────────────────────────

type GameId = string | number;

type GameConfig = {
  name: string;
  url: string;
  id: GameId;
  cssId?: string;
  autoLogin?: boolean;
};

type DiscordPanelConfig = {
  enabled: boolean;
  position: 'top' | 'bottom' | 'left' | 'right';
  size: number;
  url: string;
};

type AppConfig = {
  games: GameConfig[];
  background?: string;
  backgrounds?: string[];
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  customCSS?: string;
  ignoreCertificateErrors?: boolean;
  autoCacheClear?: boolean;
  cachePath?: string;
  keyboardLayout?: 'qwerty' | 'azerty' | 'qwertz';
  lobbyMusic?: string[];
  lobbyMusicVolume?: number;
  discord?: DiscordPanelConfig;
};

type UserData = {
  cachePath?: string;
  app?: Partial<AppConfig>;
  [key: string]: unknown;
};

type GameUserData = {
  user: string;
  password: number[];
  adminPassword: number[];
};

type GameUserDataDecrypted = {
  user: string;
  password: string;
  adminPassword: string;
};

type SaveUserData = {
  gameId: GameId;
  user: string;
  password: string;
  adminPassword: string;
};

// ─── Preload API ──────────────────────────────────────────────────────────────

type ClientApi = {
  userData:          (gameId: GameId) => Promise<GameUserDataDecrypted>;
  appVersion:        () => Promise<string>;
  appConfig:         () => Promise<AppConfig>;
  localAppConfig:    () => Promise<Partial<AppConfig>>;
  cachePath:         () => Promise<string>;
  setCachePath:      (p: string) => void;
  saveUserData:      (d: SaveUserData) => void;
  clearCache:        () => void;
  saveAppConfig:     (d: Partial<AppConfig>) => void;
  setPipewireQuantum:(frames: number) => void;
  getSystemInfo:     () => Promise<SystemInfo>;
  toggleDiscord:     () => void;
  setDiscordPanel:   (config: Partial<DiscordPanelConfig>) => void;
  getDiscordConfig:  () => Promise<DiscordPanelConfig>;
  launchGame:        (id: GameId) => void;
};

type FoundryApi = {
  returnToSelect: () => void;
};

type SplitterApi = {
  start: () => void;
  move:  (pos: number) => void;
  end:   () => void;
};

type SystemInfo = {
  platform: string;
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  pipewireActive: boolean;
  waylandActive: boolean;
};

declare interface Window {
  api: ClientApi;
}
