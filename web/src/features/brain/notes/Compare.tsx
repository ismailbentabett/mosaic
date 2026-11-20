import { Code, Paper } from '@mantine/core';

/** Raw text of one version, scrollable, never rendered as Markdown. */
export function Compare({ text }: { text: string }) {
  return (
    <Paper withBorder radius="sm" p={0}>
      <Code block mah={320} style={{ overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'transparent' }}>
        {text}
      </Code>
    </Paper>
  );
}
