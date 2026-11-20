// Screen-reader text for a chart: the same numbers as a plain list (charts are pictures to assistive tech).
import { VisuallyHidden } from '@mantine/core';

export function ChartText({ label, rows }: { label: string; rows: string[] }) {
  if (rows.length === 0) return null;
  return (
    <VisuallyHidden>
      <p>{label}</p>
      <ul>
        {rows.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </VisuallyHidden>
  );
}
