import { Badge, Button, Group, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { CircleAlert, GitMerge } from 'lucide-react';
import type { ConflictRecord } from '../types/course';
import { formatValue, OBSTACLE_FIELD_LABELS } from '../utils/collab';
import { useCourseStore } from '../stores/courseStore';

const kindMeta: Record<ConflictRecord['kind'], { label: string; color: string }> = {
  scalar: { label: '参数', color: 'indigo' },
  'obstacle-field': { label: '同一障碍', color: 'orange' },
  'obstacle-delete': { label: '删除/调整', color: 'red' },
  sequence: { label: '跳次顺序', color: 'violet' },
};

function sequenceText(ids: unknown): string {
  if (!Array.isArray(ids)) return '（空）';
  return ids.map((id, index) => `#${index + 1} ${String(id).slice(-4)}`).join(' → ');
}

function ConflictCard({ conflict }: { conflict: ConflictRecord }) {
  const resolveConflict = useCourseStore((state) => state.resolveConflict);
  const meta = kindMeta[conflict.kind];

  const localText =
    conflict.kind === 'sequence'
      ? sequenceText(conflict.localValue)
      : conflict.kind === 'obstacle-delete'
        ? conflict.localValue
          ? '保留并继续使用这道障碍'
          : '删除这道障碍'
        : conflict.kind === 'obstacle-field'
          ? conflict.fields
              ?.map((field) => `${OBSTACLE_FIELD_LABELS[field.key] ?? field.key} ${formatValue(field.local)}`)
              .join('；')
        : formatValue(conflict.localValue);

  const remoteText =
    conflict.kind === 'sequence'
      ? sequenceText(conflict.remoteValue)
      : conflict.kind === 'obstacle-delete'
        ? conflict.remoteValue
          ? '保留并继续使用这道障碍'
          : '删除这道障碍'
        : conflict.kind === 'obstacle-field'
          ? conflict.fields
              ?.map((field) => `${OBSTACLE_FIELD_LABELS[field.key] ?? field.key} ${formatValue(field.remote)}`)
              .join('；')
        : formatValue(conflict.remoteValue);

  return (
    <Paper withBorder p="sm" radius="md" className="conflict-card">
      <Group justify="space-between" mb={6}>
        <Group gap={6}>
          <CircleAlert size={15} className="conflict-icon" />
          <Text size="sm" fw={800}>{conflict.title}</Text>
        </Group>
        <Badge size="xs" color={meta.color}>{meta.label}</Badge>
      </Group>
      <Text size="xs" c="dimmed" mb={10}>{conflict.detail}</Text>
      <div className="conflict-sides">
        <button
          type="button"
          className="conflict-side conflict-side-local"
          onClick={() => resolveConflict(conflict.id, 'local')}
        >
          <Text size="xs" fw={800} c="indigo">采用本机版本</Text>
          <Text size="xs" className="conflict-value">{localText}</Text>
        </button>
        <button
          type="button"
          className="conflict-side conflict-side-remote"
          onClick={() => resolveConflict(conflict.id, 'remote')}
        >
          <Text size="xs" fw={800} c="teal">采用对方版本</Text>
          <Text size="xs" className="conflict-value">{remoteText}</Text>
        </button>
      </div>
    </Paper>
  );
}

export function ConflictResolver() {
  const conflicts = useCourseStore((state) => state.session?.conflicts ?? []);

  if (conflicts.length === 0) {
    return (
      <Paper className="empty-inspector" p="lg">
        <GitMerge size={20} />
        <Text fw={800} mt={8}>当前没有待裁决冲突</Text>
        <Text size="sm" c="dimmed" mt={6}>
          两边改到同一个障碍的同一字段、删除与调整撞车，或跳次顺序在同一区域都被重排时，
          合并会保留两版并列在这里，由你拍板采用哪一版。
        </Text>
      </Paper>
    );
  }

  return (
    <Stack gap="sm">
      <Badge color="red" variant="light" size="lg">
        {conflicts.length} 处冲突待裁决
      </Badge>
      <Text size="xs" c="dimmed">
        无冲突的调整已经并入；下列条目两边都改过，先保留两版。逐条选定版本后即可保存到共享盘。
      </Text>
      <ScrollArea h={560} offsetScrollbars>
        <Stack gap="sm" pr={4}>
          {conflicts.map((conflict) => (
            <ConflictCard key={conflict.id} conflict={conflict} />
          ))}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
