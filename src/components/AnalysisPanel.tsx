import { Alert, Badge, Button, Group, Progress, ScrollArea, Table, Text } from '@mantine/core';
import { AlertCircle, CheckCircle2, RefreshCw, TriangleAlert } from 'lucide-react';
import type { RouteAnalysis } from '../types/course';

interface AnalysisPanelProps {
  analysis: RouteAnalysis;
  stale?: boolean;
  onRecompute?: () => void;
}

const levelMeta = {
  ok: { color: 'teal', icon: CheckCircle2, label: '合理' },
  warning: { color: 'yellow', icon: TriangleAlert, label: '需调整' },
  error: { color: 'red', icon: AlertCircle, label: '风险' },
} as const;

export function AnalysisPanel({ analysis, stale = false, onRecompute }: AnalysisPanelProps) {
  return (
    <div className="analysis-panel">
      {stale && (
        <Alert
          color="yellow"
          variant="light"
          mb="md"
          icon={<TriangleAlert size={16} />}
          title="步数表与稳定度已失效"
        >
          <Text size="xs" mb="xs">
            路线、场地尺寸或马匹步幅已变更，以下为旧结果。重算后才能导出裁判表。
          </Text>
          <Button size="xs" color="yellow" leftSection={<RefreshCw size={13} />} onClick={onRecompute}>
            重新计算
          </Button>
        </Alert>
      )}
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xs" c="dimmed">路线稳定度</Text>
          <Text fw={900} fz={30}>{analysis.score}<span className="score-unit">/100</span></Text>
        </div>
        <div className="analysis-metrics">
          <Text size="xs" c="dimmed">总距离</Text>
          <Text fw={800}>{analysis.totalDistance} m</Text>
          <Text size="xs" c="dimmed" mt={5}>预计用时</Text>
          <Text fw={800}>{analysis.estimatedSeconds} s</Text>
        </div>
      </Group>
      <Progress
        value={analysis.score}
        color={analysis.score > 85 ? 'teal' : analysis.score > 65 ? 'yellow' : 'red'}
        size="sm"
        radius="xl"
      />

      <Text className="panel-subtitle">实时风险检查</Text>
      <div className="issue-list">
        {analysis.issues.length === 0 ? (
          <div className="issue-item issue-ok">
            <CheckCircle2 size={18} />
            <div>
              <Text size="sm" fw={750}>当前路线参数合理</Text>
              <Text size="xs" c="dimmed">未发现距离、转角或交叉冲突。</Text>
            </div>
          </div>
        ) : (
          analysis.issues.map((issue) => {
            const meta = levelMeta[issue.level];
            const Icon = meta.icon;
            return (
              <div className={`issue-item issue-${issue.level}`} key={issue.id}>
                <Icon size={18} />
                <div>
                  <Group gap="xs">
                    <Text size="sm" fw={750}>{issue.title}</Text>
                    <Badge size="xs" color={meta.color}>{meta.label}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mt={3}>{issue.detail}</Text>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Text className="panel-subtitle">逐跳步数表</Text>
      <ScrollArea h={220}>
        <Table highlightOnHover verticalSpacing="xs" horizontalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>跳次</Table.Th>
              <Table.Th>距离</Table.Th>
              <Table.Th>实测</Table.Th>
              <Table.Th>推荐</Table.Th>
              <Table.Th>转角</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {analysis.rows.map((row) => (
              <Table.Tr key={`${row.fromId}-${row.toId}`}>
                <Table.Td><Text size="xs" fw={750}>{row.fromNumber} → {row.toNumber}</Text></Table.Td>
                <Table.Td><Text size="xs">{row.distance} m</Text></Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={row.level === 'error' ? 'red' : row.level === 'warning' ? 'yellow' : 'teal'}>
                    {row.strides}
                  </Badge>
                </Table.Td>
                <Table.Td><Text size="xs" fw={750}>{row.recommended}</Text></Table.Td>
                <Table.Td><Text size="xs">{row.turnAngle}°</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </div>
  );
}

