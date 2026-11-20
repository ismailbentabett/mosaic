import {
  ActionIcon,
  Badge,
  Button,
  Card,
  createTheme,
  defaultVariantColorsResolver,
  type VariantColorsResolver,
  Drawer,
  Kbd,
  Menu,
  Modal,
  Paper,
  SegmentedControl,
  Tabs,
  TextInput,
  Textarea,
  NumberInput,
  Select,
  Tooltip,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core';

/**
 * The one theme file. Mantine defaults plus:
 * - `brand` = Tailwind indigo; shade 6 (#4F46E5) in light, shade 3 (#A5B4FC) in dark = the Mosaic accent.
 * - A cool, slightly blue dark palette (#0C0E12 floor) instead of Mantine's neutral greys.
 * Components get calm defaults (bordered cards, md radius). No component CSS lives anywhere else.
 */
const brand: MantineColorsTuple = [
  '#eef2ff',
  '#e0e7ff',
  '#c7d2fe',
  '#a5b4fc',
  '#818cf8',
  '#6366f1',
  '#4f46e5',
  '#4338ca',
  '#3730a3',
  '#312e81',
];

/**
 * `signal` = the "now" colour and nothing else (running timer, now-line, live workout, live mic).
 * Tailwind orange. Shade 7 (#C2410C) is used in light mode, shade 4 (#FB923C) in dark.
 */
const signal: MantineColorsTuple = [
  '#fff4ed',
  '#ffe6d5',
  '#fecaaa',
  '#fdac74',
  '#fb923c',
  '#f97316',
  '#ea580c',
  '#c2410c',
  '#9a3412',
  '#7c2d12',
];

const dark: MantineColorsTuple = [
  '#D5D9DF',
  '#B4B9C1',
  '#8A9099',
  '#6B717B',
  '#464C56',
  '#353A43',
  '#272B33',
  '#1B1E24',
  '#14171C',
  '#0C0E12',
];

const FONT =
  "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Arabic', sans-serif";

/**
 * Filled primary surfaces take their text colour per scheme. Mantine picks it once from the light shade
 * (white on indigo-6), which would leave white text on the light indigo-3 fill in dark mode.
 */
const variantColorResolver: VariantColorsResolver = (input) => {
  const r = defaultVariantColorsResolver(input);
  const primary = !input.color || input.color === 'brand';
  const filled = input.variant === 'filled' || input.variant === undefined;
  if (primary && filled) r.color = 'var(--mantine-primary-color-contrast)';
  // Other theme colours: dark mode fills with shade 4 (light), so white text failed; --app-filled-text is set in dark only.
  else if (filled && input.color && input.color in input.theme.colors) r.color = `var(--app-filled-text, ${r.color})`;
  return r;
};

export const theme = createTheme({
  variantColorResolver,
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 3 },
  colors: { brand, dark, signal },
  autoContrast: true,
  defaultRadius: 'md',
  cursorType: 'pointer',
  fontFamily: FONT,
  fontFamilyMonospace: "ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace",
  headings: {
    fontFamily: FONT,
    fontWeight: '650',
    sizes: {
      h1: { fontSize: '1.625rem', lineHeight: '1.25' },
      h2: { fontSize: '1.375rem', lineHeight: '1.3' },
      h3: { fontSize: '1.125rem', lineHeight: '1.35' },
      h4: { fontSize: '1rem', lineHeight: '1.4' },
    },
  },
  components: {
    // Shortcut badges stay readable: Mantine's xs Kbd is 10px.
    Kbd: Kbd.extend({ styles: { root: { fontSize: 'var(--mantine-font-size-xs)' } } }),
    Card: Card.extend({ defaultProps: { withBorder: true, radius: 'lg', padding: 'md' } }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
    Button: Button.extend({ defaultProps: { radius: 'md' } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { variant: 'subtle', color: 'gray', radius: 'md' } }),
    // Badges: Mantine's xs/sm are 9-10px uppercase. Floor of the type scale is 12px, sentence case.
    Badge: Badge.extend({
      defaultProps: { variant: 'light', radius: 'sm' },
      vars: (_t, props) => {
        const h: Record<string, string> = { xs: '20px', sm: '22px', md: '24px', lg: '28px', xl: '32px' };
        const size = typeof props.size === 'string' && props.size in h ? props.size : 'md';
        return { root: { '--badge-fz': size === 'lg' || size === 'xl' ? '14px' : '12px', '--badge-height': h[size] } };
      },
      styles: { root: { textTransform: 'none', letterSpacing: 0, fontWeight: 600 } },
    }),
    Tooltip: Tooltip.extend({ defaultProps: { openDelay: 400, withArrow: true } }),
    Menu: Menu.extend({ defaultProps: { shadow: 'md', radius: 'md', position: 'bottom-end' } }),
    Modal: Modal.extend({ defaultProps: { radius: 'lg', centered: true, overlayProps: { backgroundOpacity: 0.4, blur: 0 } } }),
    Drawer: Drawer.extend({ defaultProps: { overlayProps: { backgroundOpacity: 0.4, blur: 0 } } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: 'md' } }),
    Tabs: Tabs.extend({ defaultProps: { keepMounted: false } }),
    TextInput: TextInput.extend({ defaultProps: { radius: 'md', enterKeyHint: 'done' } }),
    Textarea: Textarea.extend({ defaultProps: { radius: 'md' } }),
    NumberInput: NumberInput.extend({ defaultProps: { radius: 'md', hideControls: true, inputMode: 'decimal', enterKeyHint: 'done' } }),
    Select: Select.extend({ defaultProps: { radius: 'md', allowDeselect: false, comboboxProps: { shadow: 'md' } } }),
  },
});

/** App-level tokens on top of Mantine's: the page floor behind cards, and the bar heights. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--app-bar-h': '64px',
    '--app-header-h': '56px',
    '--app-scrim': 'rgba(12, 14, 18, 0.4)',
  },
  light: {
    // Secondary text and placeholders pass 4.5:1 on both the floor and white cards (Mantine's gray.6 was 3.1:1).
    '--mantine-color-dimmed': '#5F6670',
    '--mantine-color-placeholder': '#6B7280',
    '--app-bg': '#F6F7F9',
    '--app-surface': '#FFFFFF',
    '--app-hover': 'var(--mantine-color-gray-0)',
    // Bar-list labels use this as text on a 10% tint of itself.
    '--app-bar-fill': 'var(--mantine-color-brand-7)',
    // Light yellow/red text on their tinted backgrounds was under 4.5:1; darker text keeps the hue.
    '--mantine-color-yellow-light-color': '#8A5A00',
    '--mantine-color-red-light-color': 'var(--mantine-color-red-9)',
    '--mantine-color-red-text': 'var(--mantine-color-red-9)',
    '--mantine-color-error': 'var(--mantine-color-red-9)',
    '--mantine-color-yellow-text': '#8A5A00',
    '--mantine-color-orange-text': 'var(--mantine-color-orange-9)',
    // Block colours as filled badges carry white text: shade 7 of blue/cyan was 3.4-4.0:1, one darker passes.
    '--mantine-color-blue-filled': 'var(--mantine-color-blue-8)',
    '--mantine-color-blue-filled-hover': 'var(--mantine-color-blue-9)',
    '--mantine-color-cyan-filled': 'var(--mantine-color-cyan-9)',
    '--mantine-color-cyan-filled-hover': 'var(--mantine-color-cyan-9)',
    '--mantine-color-grape-filled': 'var(--mantine-color-grape-8)',
    '--mantine-color-grape-filled-hover': 'var(--mantine-color-grape-9)',
  },
  dark: {
    // #8A9099 was 4.41:1 on the card surface; this is 5.6:1 there and 6.6:1 on the floor.
    '--mantine-color-dimmed': '#9BA1AA',
    '--mantine-color-placeholder': '#8A9099',
    '--app-bg': '#0C0E12',
    '--app-surface': '#14171C',
    '--app-hover': '#1B1E24',
    '--app-bar-fill': 'var(--mantine-color-brand-2)',
    '--app-filled-text': 'var(--mantine-color-dark-9)',
    // Mantine's red.8 is 3.1:1 on dark inputs; red.4 is 6:1.
    '--mantine-color-error': 'var(--mantine-color-red-4)',
    '--mantine-color-body': '#14171C',
  },
});

/** Browser chrome / Android status bar colour per scheme (matches --app-bg). */
export const CHROME = { light: '#F6F7F9', dark: '#0C0E12' } as const;
