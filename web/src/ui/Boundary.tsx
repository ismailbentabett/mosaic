import { Alert, Button, Group, Text } from '@mantine/core';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; label?: string; /** Changing this clears a caught error (e.g. the route path). */ resetKey?: unknown };
type State = { error: Error | null; key: unknown };

/**
 * Catches a render crash so one broken pane does not blank the whole app.
 * Calm notice with a retry; the error goes to the console for debugging.
 */
export class Boundary extends Component<Props, State> {
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
      <Alert
        role="alert"
        variant="light"
        color="yellow"
        m="md"
        icon={<IconAlertTriangle size={18} stroke={1.75} />}
        title={this.props.label ? `${this.props.label} could not load` : 'This part could not load'}
      >
        <Text size="sm">Nothing was lost. Try again, or reload the app.</Text>
        <Group gap="xs" mt="sm">
          <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Button size="xs" variant="subtle" color="gray" onClick={() => location.reload()}>
            Reload
          </Button>
        </Group>
      </Alert>
    );
  }
}
