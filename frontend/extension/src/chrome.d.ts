type ChromeTab = { id?: number; url?: string; windowId?: number; status?: string; lastAccessed?: number };
type ChromeMessageSender = { tab?: ChromeTab; id?: string };

declare const chrome: {
  runtime: {
    id: string;
    getManifest(): { version: string };
    lastError?: { message?: string };
    onMessage: { addListener(listener: (message: unknown, sender: ChromeMessageSender, respond: (value: unknown) => void) => boolean | void): void };
    sendMessage(message: unknown, callback?: (value: unknown) => void): void;
  };
  tabs: {
    query(query: { active?: boolean; currentWindow?: boolean }, callback: (tabs: ChromeTab[]) => void): void;
    sendMessage(tabId: number, message: unknown, callback: (value: unknown) => void): void;
    create(properties: { url: string; active?: boolean }): Promise<ChromeTab>;
    get(tabId: number): Promise<ChromeTab>;
    remove(tabId: number): Promise<void>;
    captureVisibleTab(windowId: number, options: { format: "jpeg" | "png"; quality?: number }): Promise<string>;
  };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
  permissions: {
    contains(permissions: { origins: string[] }): Promise<boolean>;
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
};
