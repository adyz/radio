const THEME_COLORS = {
  light: '#fffdef',
  dark: '#434238',
} as const;

export function initTheme(): void {
  updateThemeColor();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColor);
}

function updateThemeColor(): void {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const color = isDark ? THEME_COLORS.dark : THEME_COLORS.light;

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}
