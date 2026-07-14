export const Colors = {
  // ── Backgrounds ──────────────────────────────────────────────────────────
  bg: '#060e1b',
  surfaceLowest: '#000000',
  surfaceLow: '#0a1421',
  surface: '#0f1a29',
  surfaceHigh: '#152030',
  surfaceHighest: '#1a2638',
  surfaceBright: '#1f2d40',

  // ── Glass ────────────────────────────────────────────────────────────────
  glass: 'rgba(57,71,95,0.40)',
  glassBorder: 'rgba(143,245,255,0.10)',
  glassHigh: 'rgba(57,71,95,0.55)',

  // ── Primary (cyan) ───────────────────────────────────────────────────────
  primary: '#8ff5ff',
  primaryDim: '#00deec',
  primaryFixed: '#00eefc',
  cyan: '#00F0FF',           // kept for compat
  cyanDim: '#00deec',        // kept for compat
  cyanGlow: 'rgba(0,240,255,0.15)',
  cyanGlowStrong: 'rgba(0,240,255,0.25)',

  // ── Tertiary (blue) ──────────────────────────────────────────────────────
  tertiary: '#65afff',
  tertiaryDim: '#4aa2f9',
  blue: '#65afff',           // kept for compat

  // ── Error ────────────────────────────────────────────────────────────────
  error: '#ff716c',
  errorDim: '#d7383b',
  errorContainerBg: 'rgba(159,5,25,0.15)',
  errorBorder: 'rgba(255,113,108,0.35)',
  red: '#ff716c',            // kept for compat

  // ── Warning ──────────────────────────────────────────────────────────────
  orange: '#ffb347',

  // ── Text ─────────────────────────────────────────────────────────────────
  onSurface: '#e0e8fa',
  onSurfaceVariant: '#a3abbc',
  outline: '#6d7685',
  outlineVariant: '#404857',
  textPrimary: '#e0e8fa',    // kept for compat
  textMuted: '#a3abbc',      // kept for compat
  textFaint: '#6d7685',      // kept for compat

  // ── Borders ──────────────────────────────────────────────────────────────
  border: 'rgba(255,255,255,0.05)',
  borderSubtle: 'rgba(64,72,87,0.6)',
  borderActive: 'rgba(0,240,255,0.30)',
  borderPrimary: 'rgba(143,245,255,0.20)',

  // ── Gradients ────────────────────────────────────────────────────────────
  gradientDepth: ['#060e1b', '#0a1628', '#0d2040'] as const,
  gradientCyan: ['rgba(0,240,255,0.20)', 'rgba(0,240,255,0)'] as const,
  gradientCard: ['rgba(15,26,41,0.90)', 'rgba(9,16,28,0.95)'] as const,

  // ── Legacy surface alias ─────────────────────────────────────────────────
  surface2: 'rgba(57,71,95,0.22)',
  glass2: 'rgba(15,26,41,0.85)',
} as const;
