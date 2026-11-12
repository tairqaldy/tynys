import { useLayoutEffect, useState } from 'react';
import { useMediaQuery } from './hooks';
import { load, save } from './storage';

export type Theme = 'light' | 'dark';

/** Light or dark: the stored choice wins, otherwise the system setting. */
export function useTheme(): [Theme, () => void] {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [pref, setPref] = useState<Theme | null>(() => {
    const t = load('tynys.theme');
    return t === 'light' || t === 'dark' ? t : null;
  });
  const theme: Theme = pref ?? (systemDark ? 'dark' : 'light');
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setPref(next);
    save('tynys.theme', next);
  };
  return [theme, toggle];
}
