import { ActionIcon, Badge, Box, Button, Group, Kbd, Stack, Text, Textarea, Tooltip, UnstyledButton } from "@mantine/core";
import { IconArrowBackUp, IconArchive, IconCornerDownLeft, IconX } from "@tabler/icons-react";
import { type KeyboardEvent, type RefObject } from "react";
import { KIND_ICON, STROKE } from "../../app/icons";
import { plural } from "../../fmt";
import { feel } from "../../sound";
import { MicToggle, type useDictation } from "../../ui/Mic";
import { ScrollRow } from "../../ui/RouteTabs";
import { KINDS, LABEL, PLACEHOLDER } from "./labels";
import { type Recent } from "./store";
import { type QuickKind, type QuickType } from "./parseQuick";

/** Type chips. Auto shows what it picked. */
export function KindChips({
  kind,
  text,
  detectedType,
  pickKind,
}: {
  kind: QuickKind;
  text: string;
  detectedType: QuickType;
  pickKind: (k: QuickKind) => void;
}) {
  return (
    <ScrollRow active={kind}>
      <Group gap={6} wrap="nowrap" pb={2}>
        {KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          const on = kind === k;
          return (
            <Button
              key={k}
              size="compact-sm"
              radius="xl"
              variant={on ? "filled" : "default"}
              leftSection={<Icon size={15} stroke={STROKE} />}
              onClick={() => pickKind(k)}
              aria-pressed={on}
              styles={{ root: { flexShrink: 0 } }}
            >
              {k === "auto" && on && text.trim()
                ? `Auto · ${LABEL[detectedType]}`
                : LABEL[k]}
            </Button>
          );
        })}
      </Group>
    </ScrollRow>
  );
}

/** The text field with its clear button. */
export function QuickField({
  fieldRef,
  text,
  onText,
  onKey,
  kind,
  type,
  onClear,
}: {
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onText: (v: string) => void;
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  kind: QuickKind;
  type: QuickType;
  onClear: () => void;
}) {
  return (
    <Textarea
      ref={fieldRef}
      value={text}
      onChange={(e) => onText(e.currentTarget.value)}
      onKeyDown={onKey}
      placeholder={PLACEHOLDER[kind === "auto" ? "auto" : kind]}
      autosize
      minRows={2}
      maxRows={8}
      size="md"
      radius="md"
      data-draft
      aria-label="Quick add text"
      enterKeyHint={type === "note" ? "enter" : "done"}
      rightSection={
        text ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onClear}
            aria-label="Clear text"
          >
            <IconX size={14} />
          </ActionIcon>
        ) : null
      }
      rightSectionProps={{
        style: { alignItems: "flex-start", paddingTop: 10 },
      }}
    />
  );
}

/** Live preview: what will be saved, where. */
export function PreviewLine({
  type,
  line,
  error,
  goes,
  remembered,
}: {
  type: QuickType;
  line: string | null;
  error: string | null;
  goes: string;
  remembered: boolean;
}) {
  const DetIcon = KIND_ICON[type];
  return (
    <Group gap={8} wrap="nowrap" align="flex-start" mih={22}>
      <Box c={line ? "teal" : "dimmed"} pt={2} style={{ flexShrink: 0 }}>
        <DetIcon size={16} stroke={STROKE} />
      </Box>
      <Text
        size="sm"
        c={error ? "red" : line ? undefined : "dimmed"}
        style={{ flex: 1 }}
        aria-live="polite"
      >
        {error ?? line ?? `${goes}.`}
      </Text>
      {remembered && (
        <Badge size="xs" variant="light" color="gray">
          remembered
        </Badge>
      )}
    </Group>
  );
}

/** Keyboard hints (desktop) and the offline queue line. */
export function QuickHints({
  phone,
  queued,
  online,
}: {
  phone: boolean;
  queued: number;
  online: boolean;
}) {
  return (
    <>
      {!phone && (
        <Text size="xs" c="dimmed">
          <Kbd size="xs">Enter</Kbd> saves · <Kbd size="xs">Shift</Kbd>+
          <Kbd size="xs">Enter</Kbd> new line · <Kbd size="xs">Ctrl</Kbd>+
          <Kbd size="xs">Shift</Kbd>+<Kbd size="xs">Enter</Kbd> saves as a
          note
        </Text>
      )}

      {(queued > 0 || !online) && (
        <Text size="xs" c="dimmed">
          {queued > 0
            ? `${plural(queued, "capture")} waiting to send${
                online ? "" : ", offline"
              }.`
            : "Offline. Tasks and notes are kept on this device until you are back."}
        </Text>
      )}
    </>
  );
}

/** Recent: tap to add the same thing again. */
export function RecentList({
  recent,
  onPick,
}: {
  recent: Recent[];
  onPick: (r: Recent) => void;
}) {
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed" fw={600}>
        Recent
      </Text>
      {recent.map((r) => {
        const Icon = KIND_ICON[r.type];
        return (
          <UnstyledButton
            key={`${r.type}-${r.at}`}
            onClick={() => {
              feel("tap");
              onPick(r);
            }}
            py={6}
            px={8}
            style={{ borderRadius: "var(--mantine-radius-md)" }}
            aria-label={`Again: ${LABEL[r.type]} ${r.label}`}
          >
            <Group gap={8} wrap="nowrap">
              <Icon
                size={16}
                stroke={STROKE}
                color="var(--mantine-color-dimmed)"
              />
              <Text size="sm" truncate style={{ flex: 1 }}>
                {r.label}
              </Text>
              <IconArrowBackUp
                size={14}
                stroke={STROKE}
                color="var(--mantine-color-dimmed)"
              />
            </Group>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}

/** Mic, park and save. */
export function QuickFooter({
  d,
  onMicPress,
  onPark,
  onSave,
  busy,
  text,
  type,
  habit,
  phone,
}: {
  d: ReturnType<typeof useDictation>;
  onMicPress: () => void;
  onPark: () => void;
  onSave: () => void;
  busy: boolean;
  text: string;
  type: QuickType;
  habit: string;
  phone: boolean;
}) {
  const DetIcon = KIND_ICON[type];
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <MicToggle d={d} label="Record" showLabel elapsed onPress={onMicPress} />
      <Group gap="xs" wrap="nowrap">
        <Tooltip
          label="Park it: out of your head, back when you ask"
          openDelay={400}
        >
          <ActionIcon
            size="lg"
            variant="default"
            radius="md"
            onClick={onPark}
            disabled={!text.trim() || busy}
            aria-label="Park it"
          >
            <IconArchive size={18} stroke={STROKE} />
          </ActionIcon>
        </Tooltip>
        <Button
          onClick={onSave}
          loading={busy}
          disabled={!text.trim() && !(type === "habit" && habit)}
          leftSection={<DetIcon size={18} stroke={STROKE} />}
          rightSection={
            phone ? undefined : <IconCornerDownLeft size={14} stroke={STROKE} />
          }
        >
          Save {LABEL[type].toLowerCase()}
        </Button>
      </Group>
    </Group>
  );
}
