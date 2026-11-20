import { Group, Stack, Text } from '@mantine/core';
import { BRAND } from '../brand';

/**
 * The Mosaic mark: a dark rounded tile holding a 2x2 grid of rounded tiles (indigo, amber, teal, rose),
 * the amber one turned slightly. Same geometry as public/icons/icon.svg; reads on light and dark surfaces.
 */
export function BrandMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="512" height="512" rx="112" fill="var(--brand-tile, #0F172A)" />
      <rect x="80" y="80" width="160" height="160" rx="40" fill="#4F46E5" />
      <rect x="272" y="80" width="160" height="160" rx="40" fill="#F59E0B" transform="rotate(10 352 160)" />
      <rect x="80" y="272" width="160" height="160" rx="40" fill="#14B8A6" />
      <rect x="272" y="272" width="160" height="160" rx="40" fill="#F43F5E" />
    </svg>
  );
}

/** Mark + name (+ tagline). Login and the sidebar. */
export function BrandLockup({ size = 32, tagline = false }: { size?: number; tagline?: boolean }) {
  return (
    <Group gap={10} wrap="nowrap">
      <BrandMark size={size} />
      <Stack gap={0}>
        <Text fw={650} size={size >= 40 ? 'xl' : 'md'} lh={1.15} style={{ letterSpacing: '-0.01em' }}>
          {BRAND.name}
        </Text>
        {tagline && (
          <Text size="xs" c="dimmed" lh={1.2}>
            {BRAND.tagline}
          </Text>
        )}
      </Stack>
    </Group>
  );
}
