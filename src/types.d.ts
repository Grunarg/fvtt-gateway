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
  // Issue #7: Tastaturlayout
  keyboardLayout?: 'qwerty' | 'azerty' | 'qwertz';
  // Musik-Feature (Issue #4)
  lobbyMusic?: string[];
  lobbyMusicVolume?: number;
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

type WindowData = {
  gameId: GameId;
  autoLogin: boolean;
};

type WindowsData = {
  [index: number]: WindowData;
};

// ─── Preload API ──────────────────────────────────────────────────────────────

type ClientApi = {
  userData:          (gameId: GameId) => Promise<GameUserDataDecrypted>;
  appVersion:        () => Promise<string>;
  appConfig:         () => Promise<AppConfig>;
  localAppConfig:    () => Promise<Partial<AppConfig>>;
  cachePath:         () => Promise<string>;
  setCachePath:      (p: string) => void;
  returnToSelect:    () => void;
  saveUserData:      (d: SaveUserData) => void;
  openGame:          (id: GameId) => void;
  clearCache:        () => void;
  saveAppConfig:     (d: Partial<AppConfig>) => void;
  setPipewireQuantum:(frames: number) => void;
  getSystemInfo:     () => Promise<SystemInfo>;
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
