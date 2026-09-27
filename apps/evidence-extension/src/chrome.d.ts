declare const chrome: {
  runtime: {
    id: string;
    getManifest(): { version: string };
    lastError?: { message?: string };
    onMessage: { addListener(listener: (message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean | void): void };
    sendMessage(message: unknown, callback?: (value: unknown) => void): void;
  };
  tabs: {
    query(query: { active?: boolean; currentWindow?: boolean }, callback: (tabs: Array<{ id?: number; url?: string; lastAccessed?: number }>) => void): void;
    sendMessage(tabId: number, message: unknown, callback: (value: unknown) => void): void;
  };
  storage: { local: { get(keys: string[], callback: (value: Record<string, unknown>) => void): void; set(value: Record<string, unknown>): void } };
};
