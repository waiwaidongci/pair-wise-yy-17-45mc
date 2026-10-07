import { Badge, Button, Divider, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { GitMerge, MapPin, ArrowLeftRight, Maximize, Footprints } from 'lucide-react';
import type { Course } from '../types/course';
import type { CollabConflict } from '../utils/collab';

interface ConflictResolutionModalProps {
  opened: boolean;
  course: Course;
  conflicts: CollabConflict[];
  onResolve: (conflictId: string, choice: 'ours' | 'theirs') => void;
}

function obstacleLabel(course: Course, id: string | null): string {
  if (!id) return '（已删除）';
  const obstacle = course.obstacles.find((item) => item.id === id);
  return obstacle ? obstacle.name : '（已删除）';
}

function ObstacleConflictCard({
  course,
  conflict,
  onResolve,
}: {
  course: Course;
  conflict: Extract<CollabConflict, { kind: 'obstacle' }>;
  onResolve: (choice: 'ours' | 'theirs') => void;
}) {
  const ours = conflict.ours;
  const theirs = conflict.theirs;
  return (
    <Paper withBorder p="md" radius="md">
      <Group gap="xs" mb="sm">
        <MapPin size={15} className="conflict-icon" />
        <Text fw={800} size="sm">
          {obstacleLabel(course, conflict.obstacleId)}
        </Text>
        <Badge size="xs" color="red">双方都调整过</Badge>
      </Group>
      <Group grow align="stretch">
        <Paper className="conflict-side" p="sm" withBorder>
          <Badge size="xs" variant="light" mb={6}>我方版本</Badge>
          {ours ? (
            <Stack gap={2}>
              <Text size="xs">位置：{ours.x.toFixed(1)}, {ours.y.toFixed(1)} m</Text>
              <Text size="xs">旋转：{ours.rotation}°</Text>
              <Text size="xs">宽度：{ours.width} m · 高度：{ours.height} cm</Text>
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">我方删除了这道障碍</Text>
          )}
          <Button size="xs" variant="light" mt="sm" fullWidth onClick={() => onResolve('ours')}>
            采用我方
          </Button>
        </Paper>
        <Paper className="conflict-side" p="sm" withBorder>
          <Badge size="xs" variant="light" color="orange" mb={6}>对方版本</Badge>
          {theirs ? (
            <Stack gap={2}>
              <Text size="xs">位置：{theirs.x.toFixed(1)}, {theirs.y.toFixed(1)} m</Text>
              <Text size="xs">旋转：{theirs.rotation}°</Text>
              <Text size="xs">宽度：{theirs.width} m · 高度：{theirs.height} cm</Text>
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">对方删除了这道障碍</Text>
          )}
          <Button size="xs" variant="light" color="orange" mt="sm" fullWidth onClick={() => onResolve('theirs')}>
            采用对方
          </Button>
        </Paper>
      </Group>
    </Paper>
  );
}

function OrderConflictCard({
  course,
  conflict,
  onResolve,
}: {
  course: Course;
  conflict: Extract<CollabConflict, { kind: 'order' }>;
  onResolve: (choice: 'ours' | 'theirs') => void;
}) {
  const renderOrder = (ids: string[]) =>
    ids.map((id) => obstacleLabel(course, id)).join(' → ');
  return (
    <Paper withBorder p="md" radius="md">
      <Group gap="xs" mb="sm">
        <ArrowLeftRight size={15} className="conflict-icon" />
        <Text fw={800} size="sm">跳次顺序</Text>
        <Badge size="xs" color="red">双方都调整过</Badge>
      </Group>
      <Group grow align="stretch">
        <Paper className="conflict-side" p="sm" withBorder>
          <Badge size="xs" variant="light" mb={6}>我方顺序</Badge>
          <Text size="xs" className="conflict-order">{renderOrder(conflict.ours)}</Text>
          <Button size="xs" variant="light" mt="sm" fullWidth onClick={() => onResolve('ours')}>
            采用我方顺序
          </Button>
        </Paper>
        <Paper className="conflict-side" p="sm" withBorder>
          <Badge size="xs" variant="light" color="orange" mb={6}>对方顺序</Badge>
          <Text size="xs" className="conflict-order">{renderOrder(conflict.theirs)}</Text>
          <Button size="xs" variant="light" color="orange" mt="sm" fullWidth onClick={() => onResolve('theirs')}>
            采用对方顺序
          </Button>
        </Paper>
      </Group>
    </Paper>
  );
}

function ParamConflictCard({
  icon,
  title,
  oursLabel,
  theirsLabel,
  onResolve,
}: {
  icon: React.ReactNode;
  title: string;
  oursLabel: string;
  theirsLabel: string;
  onResolve: (choice: 'ours' | 'theirs') => void;
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group gap="xs" mb="sm">
        <span className="conflict-icon">{icon}</span>
        <Text fw={800} size="sm">{title}</Text>
        <Badge size="xs" color="red">双方都调整过</Badge>
      </Group>
      <Group grow align="stretch">
        <Paper className="conflict-side" p="sm" withBorder>
          <Badge size="xs" variant="light" mb={6}>我方</Badge>
          <Text size="xs">{oursLabel}</Text>
          <Button size="xs" variant="light" mt="sm" fullWidth onClick={() => onResolve('ours')}>
            采用我方
          </Button>
        </Paper>
        <Paper className="conflict-side" p="sm" withBorder>
          <Badge size="xs" variant="light" color="orange" mb={6}>对方</Badge>
          <Text size="xs">{theirsLabel}</Text>
          <Button size="xs" variant="light" color="orange" mt="sm" fullWidth onClick={() => onResolve('theirs')}>
            采用对方
          </Button>
        </Paper>
      </Group>
    </Paper>
  );
}

export function ConflictResolutionModal({ opened, course, conflicts, onResolve }: ConflictResolutionModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={() => undefined}
      title={
        <Group gap="xs">
          <GitMerge size={18} />
          <Text fw={800}>合并冲突：双方都改动了同一处</Text>
        </Group>
      }
      size="lg"
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
    >
      <Text size="sm" c="dimmed" mb="md">
        以下改动无法自动合并，已先保留两版。请逐处选择采用哪一版；未冲突的改动已直接并入。
      </Text>
      <Stack gap="md">
        {conflicts.map((conflict) => {
          if (conflict.kind === 'obstacle') {
            return (
              <ObstacleConflictCard
                key={conflict.id}
                course={course}
                conflict={conflict}
                onResolve={(choice) => onResolve(conflict.id, choice)}
              />
            );
          }
          if (conflict.kind === 'order') {
            return (
              <OrderConflictCard
                key={conflict.id}
                course={course}
                conflict={conflict}
                onResolve={(choice) => onResolve(conflict.id, choice)}
              />
            );
          }
          if (conflict.kind === 'arena') {
            const ours = conflict.ours as Course['arena'];
            const theirs = conflict.theirs as Course['arena'];
            return (
              <ParamConflictCard
                key={conflict.id}
                icon={<Maximize size={15} />}
                title="场地尺寸"
                oursLabel={`${ours.width} × ${ours.length} m`}
                theirsLabel={`${theirs.width} × ${theirs.length} m`}
                onResolve={(choice) => onResolve(conflict.id, choice)}
              />
            );
          }
          const ours = conflict.ours as Course['horse'];
          const theirs = conflict.theirs as Course['horse'];
          return (
            <ParamConflictCard
              key={conflict.id}
              icon={<Footprints size={15} />}
              title="马匹步幅"
              oursLabel={`步幅 ${ours.stepLength} m · 接近 ${ours.approach} m · 落地 ${ours.landing} m`}
              theirsLabel={`步幅 ${theirs.stepLength} m · 接近 ${theirs.approach} m · 落地 ${theirs.landing} m`}
              onResolve={(choice) => onResolve(conflict.id, choice)}
            />
          );
        })}
      </Stack>
      <Divider my="md" />
      <Text size="xs" c="dimmed">
        处理完所有冲突后即可继续编辑，或生成新的协作链接。
      </Text>
    </Modal>
  );
}
