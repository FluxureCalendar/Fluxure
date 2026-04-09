import { browser } from '$app/environment';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'fluxure-theme';

let currentTheme = $state<Theme>('system');

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme) {
  currentTheme = theme;
  if (browser) {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
  }
}

export function initTheme() {
  if (!browser) return;
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    currentTheme = stored;
  }
  applyTheme(currentTheme);
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  }
  // 'system' = no data-theme, falls back to prefers-color-scheme
}
