import { Alert, Button, Group, Text } from '@mantine/core';
import { IconAlertTriangle, IconMessage, IconRefresh } from '@tabler/icons-react';
import { Component, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Shown in the console only. */
  label?: string;
  /** Changing this (the route path) clears a caught error. */
  resetKey?: unknown;
  /** Goes back to Chat, the home page. */
  onHome: () => void;
};
type State = { error: Error | null; key: unknown };

/**
 * Screen-level crash guard: one broken screen never blanks the app.
 * Plain notice, a way back to Chat and a reload. The error goes to the console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label ?? 'screen'}] render failed`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert role="alert" variant="light" color="yellow" m="md" icon={<IconAlertTriangle size={18} stroke={1.75} />} title="This screen hit an error.">
        <Text size="sm">Nothing was lost. Go back to Chat, or reload the app.</Text>
        <Group gap="xs" mt="sm">
          <Button size="xs" variant="default" leftSection={<IconMessage size={14} />}
            onClick={() => { this.setState({ error: null }); this.props.onHome(); }}>
            Back to Chat
          </Button>
          <Button size="xs" variant="subtle" color="gray" leftSection={<IconRefresh size={14} />} onClick={() => location.reload()}>
            Reload
          </Button>
        </Group>
      </Alert>
    );
  }
}
