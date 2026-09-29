/** localStorage bywa niedostępny (tryb prywatny, zablokowane ciasteczka) - nigdy nie rzucamy błędem. */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignorujemy */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignorujemy */
    }
  },
};
