import { ActionIcon, Alert, Anchor, Box, Button, Card, Center, Group, Loader, Skeleton, Stack, Text, ThemeIcon, Title, Tooltip, VisuallyHidden } from '@mantine/core';
import { IconAlertTriangle, IconArrowLeft, IconRefresh } from '@tabler/icons-react';
import { useEffect, type ReactNode } from 'react';
import type { ApiError } from '../api';
import { BRAND } from '../brand';
import { copy } from '../copy';
import { go } from '../router';
import { openSettings } from '../ui';
import { STROKE, type AppIcon } from '../app/icons';
import { usePhone } from './Sheet';

/** Sets the document title while mounted. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${BRAND.name}` : BRAND.name;
  }, [title]);
}

type PageProps = {
  title: string;
  /** Small line under the title (date, count). */
  subtitle?: ReactNode;
  icon?: AppIcon;
  /** Back target; shows an arrow before the title. */
  back?: string;
  /** Right side of the header (buttons, menus). */
  actions?: ReactNode;
  /** Tabs or filters under the header. */
  toolbar?: ReactNode;
  children: ReactNode;
  /** Max content width. Default 880px; `wide` = 1200px for two-pane screens. */
  wide?: boolean;
  /** Hide the visible header (Today draws its own). */
  bare?: boolean;
  /** Fill the screen height (chat): the last child sits at the bottom, no bottom padding. */
  fill?: boolean;
};

/** Every routed screen: one header, one column of content, one max width. */
export function Page({ title, subtitle, icon: Icon, back, actions, toolbar, children, wide, bare, fill }: PageProps) {
  useTitle(title);
  const phone = usePhone();
  // On phones the app bar already names a top-level screen; the page keeps only its subtitle and actions.
  const quiet = phone && !back;
  const row = !bare && (!quiet || !!subtitle || !!actions);
  return (
    <Box
      maw={wide ? 1200 : 880}
      mx="auto"
      px={{ base: 'md', sm: 'lg' }}
      pt={{ base: 'sm', sm: 'lg' }}
      pb={fill ? 0 : 96}
      className={fill ? 'page-fill' : undefined}
    >
      {quiet && !bare && <VisuallyHidden component="h1">{title}</VisuallyHidden>}
      {row && (
        <Group justify="space-between" align="center" wrap="nowrap" mb={toolbar ? 'sm' : 'md'} gap="sm" mih={44}>
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            {back && (
              <ActionIcon size="lg" onClick={() => go(back)} aria-label="Back">
                <IconArrowLeft size={20} stroke={STROKE} />
              </ActionIcon>
            )}
            {Icon && !back && (
              <ThemeIcon variant="light" size={36} radius="md" visibleFrom="sm">
                <Icon size={20} stroke={STROKE} />
              </ThemeIcon>
            )}
            <Box style={{ minWidth: 0 }}>
              {!quiet && (
                <Title order={1} size="h2" lineClamp={1}>
                  {title}
                </Title>
              )}
              {subtitle && (
                <Text size="sm" c="dimmed" lineClamp={1}>
                  {subtitle}
                </Text>
              )}
            </Box>
          </Group>
          {actions && (
            <Group gap={6} wrap="nowrap" className="shrink0">
              {actions}
            </Group>
          )}
        </Group>
      )}
      {toolbar && <Box mb="md">{toolbar}</Box>}
      <Stack gap="md" className={fill ? 'page-fill-body' : undefined}>
        {children}
      </Stack>
    </Box>
  );
}

type SectionProps = {
  title?: ReactNode;
  /** Small text after the title. */
  hint?: ReactNode;
  icon?: AppIcon;
  right?: ReactNode;
  children?: ReactNode;
  /** No inner padding (lists that run edge to edge). */
  flush?: boolean;
  id?: string;
  /** Click on the header (open the module). */
  onTitleClick?: () => void;
};

/** One bordered card with an optional header row. Never nested. */
export function Section({ title, hint, icon: Icon, right, children, flush, id, onTitleClick }: SectionProps) {
  return (
    <Card id={id} padding={flush ? 0 : 'md'}>
      {(title || right) && (
        <Group justify="space-between" wrap="nowrap" gap="sm" px={flush ? 'md' : 0} pt={flush ? 'md' : 0} mb="sm">
          <Group
            gap={8}
            wrap="nowrap"
            style={{ minWidth: 0, cursor: onTitleClick ? 'pointer' : undefined }}
            onClick={onTitleClick}
            role={onTitleClick ? 'link' : undefined}
            tabIndex={onTitleClick ? 0 : undefined}
            onKeyDown={onTitleClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onTitleClick()) : undefined}
          >
            {Icon && <Icon size={18} stroke={STROKE} style={{ flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} />}
            {title && (
              <Text component="h2" m={0} fw={600} size="sm" lineClamp={1}>
                {title}
              </Text>
            )}
            {hint && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {hint}
              </Text>
            )}
          </Group>
          {right && (
            <Group gap={4} wrap="nowrap">
              {right}
            </Group>
          )}
        </Group>
      )}
      {children}
    </Card>
  );
}

/** Title row above a list, with an optional "See all" (44 px target). */
export function SectionHeader({ title, to, label = 'See all', right }: { title: ReactNode; to?: string; label?: string; right?: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" mih={44}>
      <Text component="h2" m={0} fw={600} size="sm" lineClamp={1}>
        {title}
      </Text>
      {right}
      {to && !right && (
        <Button variant="subtle" size="compact-sm" h={44} onClick={() => go(to)}>
          {label}
        </Button>
      )}
    </Group>
  );
}

/** First-load skeletons, one per layout type. */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Stack gap={0} role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Group key={i} gap="sm" wrap="nowrap" mih={56}>
          <Skeleton circle height={24} />
          <Stack gap={6} style={{ flex: 1 }}>
            <Skeleton height={12} width={`${80 - ((i * 13) % 30)}%`} radius="sm" />
            <Skeleton height={10} width="40%" radius="sm" />
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}

export function CardsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <Stack gap="md" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} height={120} radius="md" />
      ))}
    </Stack>
  );
}

export function StatSkeleton() {
  return (
    <Stack gap={6} role="status" aria-label="Loading">
      <Skeleton height={10} width={80} radius="sm" />
      <Skeleton height={28} width={140} radius="sm" />
    </Stack>
  );
}

export function ChartSkeleton({ h = 180 }: { h?: number }) {
  return <Skeleton height={h} radius="md" role="status" aria-label="Loading chart" />;
}

/** A labelled number. */
export function Stat({ label, value, sub, color }: { label: ReactNode; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <Box style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.3} lineClamp={1}>
        {label}
      </Text>
      <Text fw={650} size="xl" c={color} className="num" lineClamp={1}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed" lineClamp={2}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

export function Loading({ label = 'Loading', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <Stack gap="xs" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={i === 0 ? 20 : 14} width={`${92 - ((i * 17) % 40)}%`} radius="sm" />
      ))}
    </Stack>
  );
}

export function Spinner() {
  return (
    <Center py="xl">
      <Loader size="sm" />
    </Center>
  );
}

const SETTINGS_CODES = ['google_not_connected', 'google_auth_expired'];

/** What broke + one fix (the API's message). */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const offline = error.code === 'offline' || error.code === 'unreachable';
  return (
    <Alert variant="light" color={offline ? 'gray' : 'yellow'} icon={<IconAlertTriangle size={18} stroke={STROKE} />} title={offline ? copy.error.unreachable : copy.error.title}>
      <Text size="sm">{error.message}</Text>
      <Group gap="xs" mt="sm">
        {onRetry && (
          <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={onRetry}>
            {copy.error.retry}
          </Button>
        )}
        {SETTINGS_CODES.includes(error.code) && (
          <Button size="xs" onClick={() => openSettings('google')}>
            Open Settings
          </Button>
        )}
      </Group>
    </Alert>
  );
}

/** Calm empty state: what is missing + optionally one way to fill it. */
export function Empty({ title, children, icon: Icon, action }: { title: string; children?: ReactNode; icon?: AppIcon; action?: ReactNode }) {
  return (
    <Stack align="center" gap={6} py="lg" px="md" ta="center">
      {Icon && (
        <ThemeIcon variant="light" color="gray" size={40} radius="xl">
          <Icon size={22} stroke={STROKE} />
        </ThemeIcon>
      )}
      <Text fw={600} size="sm">
        {title}
      </Text>
      {children && (
        <Text size="sm" c="dimmed" maw={360}>
          {children}
        </Text>
      )}
      {action}
    </Stack>
  );
}

/** Quiet inline notice. */
export function Notice({ children, tone = 'quiet' }: { children: ReactNode; tone?: 'quiet' | 'warn' }) {
  return (
    <Alert variant="light" color={tone === 'warn' ? 'yellow' : 'gray'} p="sm">
      <Text size="sm" component="div">{children}</Text>
    </Alert>
  );
}

/** Data block: loading skeleton, error with retry, or the content. */
export function Async<T>({
  state,
  children,
  label,
  lines,
}: {
  state: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
  label?: string;
  lines?: number;
}) {
  if (state.data !== null) {
    // A failed refresh keeps what is on screen and says so, with one retry.
    if (state.error) {
      return (
        <>
          <Group gap={6} wrap="nowrap" role="status">
            <IconAlertTriangle size={14} stroke={STROKE} style={{ flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} />
            <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 0 }} lineClamp={1}>
              {state.error.code === 'offline' || state.error.code === 'unreachable' ? 'Offline. Showing the last copy.' : 'Could not refresh. Showing the last copy.'}
            </Text>
            <Button size="compact-sm" variant="subtle" onClick={state.reload}>
              {copy.error.retry}
            </Button>
          </Group>
          {children(state.data)}
        </>
      );
    }
    return <>{children(state.data)}</>;
  }
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return <Loading label={label} lines={lines} />;
}

/** Icon button with a tooltip (aria-label = tooltip). */
export function IconBtn({ icon: Icon, label, onClick, color, variant, size = 'lg', disabled, loading }: {
  icon: AppIcon;
  label: string;
  onClick?: () => void;
  color?: string;
  variant?: string;
  size?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <ActionIcon size={size} onClick={onClick} aria-label={label} color={color} variant={variant} disabled={disabled} loading={loading}>
        <Icon size={20} stroke={STROKE} />
      </ActionIcon>
    </Tooltip>
  );
}

/** Text link that navigates in-app. */
export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Anchor
      href={'#' + to}
      className={className}
      size="sm"
      underline="always"
      onClick={(e) => {
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </Anchor>
  );
}
