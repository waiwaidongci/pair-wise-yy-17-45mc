import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  ArrowLeftRight,
  Clipboard,
  CloudOff,
  Download,
  Grid3X3,
  RefreshCw,
  WandSparkles,
  MousePointer2,
  Printer,
  Redo2,
  Save,
  Share2,
  Undo2,
  GitMerge,
  TriangleAlert,
  CheckCircle2,
  X,
} from 'lucide-react';
import { ArenaCanvas } from '../components/ArenaCanvas';
import { ObstacleInspector } from '../components/ObstacleInspector';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { ConflictResolutionModal } from '../components/ConflictResolutionModal';
import { useCourseStore } from '../stores/courseStore';
import type { ObstaclePreset } from '../types/course';
import { OBSTACLE_PRESETS } from '../utils/course';
import { courseToDataUrl } from '../utils/drawing';
import { downloadJudgeSheet, openPrintableCourse } from '../utils/exports';
import { describeDiff, diffSummary, encodeEnvelope } from '../utils/collab';

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

export function DesignerView() {
  const course = useCourseStore((state) => state.course);
  const selectedId = useCourseStore((state) => state.selectedId);
  const snapEnabled = useCourseStore((state) => state.snapEnabled);
  const gridVisible = useCourseStore((state) => state.gridVisible);
  const options = useCourseStore((state) => state.routeOptions);
  const history = useCourseStore((state) => state.history);
  const future = useCourseStore((state) => state.future);
  const analysis = useCourseStore((state) => state.analysis);
  const analysisStale = useCourseStore((state) => state.analysisStale);
  const collab = useCourseStore((state) => state.collab);
  const store = useCourseStore();
  const online = useOnline();
  const [placementPreset, setPlacementPreset] = useState<ObstaclePreset | null>(null);
  const [customColor, setCustomColor] = useState(OBSTACLE_PRESETS[0].color);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState(course.name);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [shareError, setShareError] = useState<string | null>(null);

  const selected = course.obstacles.find((item) => item.id === selectedId) ?? null;
  const selectedIndex = selected ? course.sequence.indexOf(selected.id) : -1;

  const incomingDiff = useMemo(() => {
    if (!collab.incoming || !collab.baseCourse) return null;
    return describeDiff(collab.baseCourse, collab.incoming.course);
  }, [collab.incoming, collab.baseCourse]);

  const handleDuplicate = () => {
    if (!selected) return;
    store.addObstacle(
      {
        kind: selected.kind,
        name: selected.name,
        width: selected.width,
        spread: selected.spread,
        height: selected.height,
        color: selected.color,
      },
      selected.x + 3,
      selected.y - 3,
    );
  };

  const handleShare = async () => {
    const result = store.buildShareEnvelope();
    if (!result.ok) {
      setShareError(result.reason);
      setShareText('');
      setShareOpen(true);
      return;
    }
    const token = encodeEnvelope(result.envelope);
    const url = `${window.location.origin}${window.location.pathname}#course=${token}`;
    setShareText(url);
    setShareError(null);
    setShareOpen(true);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard access can be unavailable in file preview or privacy modes.
    }
  };

  const handleExportJudgeSheet = () => {
    if (analysisStale) return;
    downloadJudgeSheet(course, analysis);
  };

  const handlePrint = () => {
    if (analysisStale) return;
    openPrintableCourse(course, analysis, courseToDataUrl(course));
  };

  return (
    <div className="designer-layout">
      <aside className="tool-rail panel-surface">
        <Text className="eyebrow">障碍库</Text>
        <Text className="rail-title">选择后点击场地</Text>
        <Stack gap={8} mt="md">
          <button
            className={`tool-card ${placementPreset === null ? 'active' : ''}`}
            onClick={() => setPlacementPreset(null)}
          >
            <MousePointer2 size={18} />
            <span><b>选择 / 移动</b><small>拖动障碍并调整布局</small></span>
          </button>
          {OBSTACLE_PRESETS.map((preset) => (
            <button
              key={preset.kind}
              className={`tool-card ${placementPreset?.kind === preset.kind ? 'active' : ''}`}
              onClick={() => {
                setPlacementPreset({ ...preset, color: customColor });
                setCustomColor(preset.color);
              }}
            >
              <span className="obstacle-swatch" style={{ background: customColor || preset.color }} />
              <span><b>{preset.name}</b><small>{preset.width} m · 高 {preset.height} cm</small></span>
            </button>
          ))}
        </Stack>
        <Divider my="md" />
        <Text size="xs" fw={700} c="dimmed" mb={7}>障碍默认颜色</Text>
        <div className="color-grid">
          {['#d94841', '#2563eb', '#f59e0b', '#1596a6', '#7c3aed', '#2f855a'].map((color) => (
            <button
              key={color}
              aria-label={`使用颜色 ${color}`}
              className={`color-dot ${customColor === color ? 'active' : ''}`}
              style={{ background: color }}
              onClick={() => {
                setCustomColor(color);
                setPlacementPreset((previous) => previous ? { ...previous, color } : previous);
              }}
            />
          ))}
        </div>
        <Divider my="md" />
        <Switch
          label="栅格吸附"
          checked={snapEnabled}
          onChange={store.toggleSnap}
          size="sm"
        />
        <Switch
          mt={10}
          label="显示栅格"
          checked={gridVisible}
          onChange={store.toggleGrid}
          size="sm"
        />
      </aside>

      <main className="workspace-column">
        <div className="course-toolbar panel-surface">
          <Group gap="sm" wrap="nowrap">
            <TextInput
              aria-label="路线名称"
              variant="unstyled"
              className="course-name-input"
              value={course.name}
              onChange={(event) => store.setCourseName(event.currentTarget.value)}
            />
            <Tooltip label={analysisStale ? '路线已变更，步数表与稳定度已失效' : '步数表与稳定度为最新'}>
              <Badge
                variant="light"
                color={analysisStale ? 'yellow' : analysis.score > 80 ? 'teal' : 'yellow'}
                leftSection={analysisStale ? <TriangleAlert size={12} /> : undefined}
              >
                {analysisStale ? '稳定度已失效' : `稳定度 ${analysis.score}`}
              </Badge>
            </Tooltip>
            {analysisStale && (
              <Button
                size="xs"
                variant="light"
                color="yellow"
                leftSection={<RefreshCw size={13} />}
                onClick={store.recomputeAnalysis}
              >
                重新计算
              </Button>
            )}
          </Group>
          <Group gap={6} wrap="nowrap">
            <Tooltip label="撤销">
              <ActionIcon variant="default" onClick={store.undo} disabled={!history.length}><Undo2 size={17} /></ActionIcon>
            </Tooltip>
            <Tooltip label="重做">
              <ActionIcon variant="default" onClick={store.redo} disabled={!future.length}><Redo2 size={17} /></ActionIcon>
            </Tooltip>
            <Button
              variant={placementPreset ? 'filled' : 'light'}
              leftSection={<WandSparkles size={16} />}
              onClick={() => {
                store.generateOptions();
                setGeneratorOpen(true);
              }}
            >
              自动生成路线
            </Button>
            <Button variant="light" leftSection={<Save size={16} />} onClick={() => { setSaveName(course.name); setSaveOpen(true); }}>
              保存
            </Button>
            <Tooltip label="复制协作分享链接">
              <ActionIcon variant="default" onClick={handleShare}><Share2 size={17} /></ActionIcon>
            </Tooltip>
          </Group>
        </div>

        <div className="collab-banner-stack">
          {!online && (
            <Alert color="gray" variant="light" icon={<CloudOff size={16} />} className="collab-banner">
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs">
                  当前离线，可继续编辑；修改保存在本机，回网后打开对方的协作链接即可合并。
                </Text>
              </Group>
            </Alert>
          )}
          {collab.status === 'incoming' && collab.incoming && (
            <Alert
              color="indigo"
              variant="light"
              icon={<GitMerge size={16} />}
              className="collab-banner"
              title={`收到 ${collab.incoming.author} 的协作修改 v${collab.incoming.revision}`}
            >
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs">
                  {incomingDiff ? diffSummary(incomingDiff) : '有新版本'}（{new Date(collab.incoming.savedAt).toLocaleString('zh-CN', { hour12: false })}）。
                  合并会自动并入不冲突的改动；双方都动过的障碍会保留两版并标出冲突。
                </Text>
                <Group gap="xs" wrap="nowrap">
                  <Button size="xs" onClick={store.mergeIncoming}>合并修改</Button>
                  <Button size="xs" variant="subtle" onClick={store.dismissIncoming}>稍后</Button>
                </Group>
              </Group>
            </Alert>
          )}
          {collab.status === 'merge-failed' && (
            <Alert
              color="red"
              variant="light"
              icon={<TriangleAlert size={16} />}
              className="collab-banner"
              title="合并失败"
            >
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs">{collab.lastError ?? '合并过程中出现问题。'}可从合并前的版本重试，已并入的内容不会丢失。</Text>
                <Group gap="xs" wrap="nowrap">
                  <Button size="xs" color="red" onClick={store.retryMerge}>重试合并</Button>
                  <Button size="xs" variant="subtle" onClick={store.dismissIncoming}>稍后</Button>
                </Group>
              </Group>
            </Alert>
          )}
          {collab.status === 'merged' && (
            <Alert
              color="teal"
              variant="light"
              icon={<CheckCircle2 size={16} />}
              className="collab-banner"
              title="合并完成"
            >
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs">双方的修改已合并为一份。可继续编辑，或生成新的协作链接发给对方。</Text>
                <ActionIcon size="xs" variant="subtle" onClick={store.dismissIncoming}><X size={14} /></ActionIcon>
              </Group>
            </Alert>
          )}
        </div>

        <div className="arena-stage panel-surface">
          <ArenaCanvas
            course={course}
            selectedId={selectedId}
            highlightedIds={analysis.issues.flatMap((issue) => issue.obstacleIds)}
            gridVisible={gridVisible}
            placementPreset={placementPreset}
            onSelect={store.select}
            onMove={store.moveObstacle}
            onPlace={store.addObstacle}
          />
          <div className="arena-statusbar">
            <Group gap="lg">
              <Text size="xs"><b>{course.arena.width} × {course.arena.length} m</b> {course.arena.surface}</Text>
              <Text size="xs">步幅 {course.horse.stepLength} m</Text>
              <Text size="xs">接近 {course.horse.approach} m</Text>
              <Text size="xs">落地 {course.horse.landing} m</Text>
            </Group>
            <Group gap="xs">
              {online ? <Badge size="xs" variant="dot" color="teal">在线</Badge> : <Badge size="xs" variant="dot" color="gray">离线</Badge>}
              <Grid3X3 size={13} />
              <Text size="xs">栅格 {course.gridSize} m</Text>
            </Group>
          </div>
        </div>
      </main>

      <aside className="right-panel panel-surface">
        <Tabs defaultValue="inspect" className="right-tabs">
          <Tabs.List grow>
            <Tabs.Tab value="inspect">障碍</Tabs.Tab>
            <Tabs.Tab value="analysis">路线分析</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="inspect" pt="md">
            <ScrollArea h="100%" offsetScrollbars>
              <ObstacleInspector
                course={course}
                obstacle={selected}
                sequenceIndex={selectedIndex}
                onUpdate={(patch) => selected && store.updateObstacle(selected.id, patch)}
                onMoveSequence={(direction) => selected && store.moveInSequence(selected.id, direction)}
                onRemove={() => selected && store.removeObstacle(selected.id)}
                onDuplicate={handleDuplicate}
              />
              <Divider my="lg" />
              <Text fw={800} size="sm" mb="sm">马匹与场地参数</Text>
              <Stack gap="sm">
                <Select
                  label="场地类型"
                  value={course.arena.surface}
                  data={['纤维沙场地', '室外草地', '室内沙地', '训练场']}
                  onChange={(value) => value && store.setArena({ surface: value })}
                />
                <Group grow>
                  <NumberInput
                    label="场地宽 (m)"
                    value={course.arena.width}
                    min={40}
                    max={100}
                    onChange={(value) => store.setArena({ width: Number(value) || 60 })}
                  />
                  <NumberInput
                    label="场地长 (m)"
                    value={course.arena.length}
                    min={60}
                    max={140}
                    onChange={(value) => store.setArena({ length: Number(value) || 90 })}
                  />
                </Group>
                <TextInput
                  label="马匹档案"
                  value={course.horse.name}
                  onChange={(event) => store.setHorse({ name: event.currentTarget.value })}
                />
                <Group grow>
                  <NumberInput
                    label="步幅 (m)"
                    value={course.horse.stepLength}
                    min={2.6}
                    max={4.5}
                    step={0.1}
                    decimalScale={1}
                    onChange={(value) => store.setHorse({ stepLength: Number(value) || 3.5 })}
                  />
                  <NumberInput
                    label="栅格 (m)"
                    value={course.gridSize}
                    min={0.5}
                    max={5}
                    step={0.5}
                    decimalScale={1}
                    onChange={(value) => store.setGridSize(Number(value) || 2)}
                  />
                </Group>
                <Group grow>
                  <NumberInput
                    label="接近段 (m)"
                    value={course.horse.approach}
                    min={0.5}
                    max={4}
                    step={0.1}
                    decimalScale={1}
                    onChange={(value) => store.setHorse({ approach: Number(value) || 1.8 })}
                  />
                  <NumberInput
                    label="落地段 (m)"
                    value={course.horse.landing}
                    min={0.5}
                    max={4}
                    step={0.1}
                    decimalScale={1}
                    onChange={(value) => store.setHorse({ landing: Number(value) || 1.6 })}
                  />
                </Group>
              </Stack>
            </ScrollArea>
          </Tabs.Panel>
          <Tabs.Panel value="analysis" pt="md">
            <ScrollArea h="100%" offsetScrollbars>
              <AnalysisPanel analysis={analysis} stale={analysisStale} onRecompute={store.recomputeAnalysis} />
            </ScrollArea>
          </Tabs.Panel>
        </Tabs>
        <div className="export-strip">
          <Tooltip label={analysisStale ? '请先重新计算步数表与稳定度' : '打印路线图'} disabled={!analysisStale}>
            <Button
              variant="light"
              fullWidth
              leftSection={<Printer size={16} />}
              onClick={handlePrint}
              disabled={analysisStale}
            >
              打印路线图
            </Button>
          </Tooltip>
          <Tooltip label={analysisStale ? '请先重新计算步数表与稳定度' : '导出裁判表 CSV'} disabled={!analysisStale}>
            <Button
              variant="light"
              fullWidth
              leftSection={<Download size={16} />}
              onClick={handleExportJudgeSheet}
              disabled={analysisStale}
            >
              导出裁判表
            </Button>
          </Tooltip>
        </div>
      </aside>

      <Modal opened={generatorOpen} onClose={() => setGeneratorOpen(false)} title="自动生成备选路线" size="lg">
        {options.length === 0 ? (
          <Text c="dimmed">正在计算路线组合与安全检查...</Text>
        ) : (
          <div className="route-option-grid">
            {options.map((option) => (
              <Paper key={option.id} className="route-option-card" p="md" withBorder>
                <Group justify="space-between">
                  <Badge color={option.difficulty === '挑战' ? 'red' : option.difficulty === '进阶' ? 'blue' : 'teal'}>
                    {option.difficulty}
                  </Badge>
                  <Text fw={900}>{option.score} 分</Text>
                </Group>
                <Text fw={800} mt="sm">{option.name}</Text>
                <Text size="xs" c="dimmed" mt={5}>{option.description}</Text>
                <Group mt="md" gap="xs">
                  <Badge variant="light">{option.sequence.length} 跳</Badge>
                  <Badge variant="light">约 {option.estimatedSeconds}s</Badge>
                </Group>
                <Button
                  mt="md"
                  fullWidth
                  variant="light"
                  leftSection={<ArrowLeftRight size={15} />}
                  onClick={() => {
                    store.applyRoute(option.sequence);
                    setGeneratorOpen(false);
                  }}
                >
                  应用这条路线
                </Button>
              </Paper>
            ))}
          </div>
        )}
      </Modal>

      <Modal opened={saveOpen} onClose={() => setSaveOpen(false)} title="保存到路线库">
        <TextInput
          label="路线名称"
          value={saveName}
          onChange={(event) => setSaveName(event.currentTarget.value)}
        />
        <Button
          mt="md"
          fullWidth
          onClick={() => {
            store.saveNamedRoute(saveName.trim() || course.name);
            setSaveOpen(false);
          }}
        >
          保存路线
        </Button>
      </Modal>

      <Modal opened={shareOpen} onClose={() => setShareOpen(false)} title="协作分享链接">
        <Text size="sm" c="dimmed">
          链接包含当前场地、马匹参数和完整障碍布局，构成一个可续作的协作版本。
          对方打开后可断网继续改，回网时合并：没冲突的直接并入，同一处双方都改了会保留两版并标出冲突。
        </Text>
        <TextInput
          mt="md"
          label="你的名字（显示在对方收到的版本上）"
          value={collab.coachName}
          onChange={(event) => store.setCoachName(event.currentTarget.value)}
          placeholder="教练"
        />
        <Group mt="xs" gap="xs">
          <Badge size="xs" variant="light" color={collab.sessionId ? 'indigo' : 'gray'}>
            {collab.sessionId ? `协作会话已建立 · 本地版本 v${collab.localRevision}` : '尚未建立协作会话'}
          </Badge>
          {collab.incoming && <Badge size="xs" variant="light" color="orange">有未合并的对方修改</Badge>}
        </Group>
        {collab.incoming && (
          <Alert
            color="indigo"
            variant="light"
            mt="md"
            icon={<GitMerge size={15} />}
            title={`收到 ${collab.incoming.author} 的协作修改 v${collab.incoming.revision}`}
          >
            {incomingDiff && <Text size="xs" mb="xs">{diffSummary(incomingDiff)}。</Text>}
            <Button
              size="xs"
              onClick={() => {
                store.mergeIncoming();
                setShareOpen(false);
              }}
            >
              立即合并
            </Button>
          </Alert>
        )}
        {shareError && (
          <Alert color="red" variant="light" mt="md" icon={<TriangleAlert size={15} />}>
            <Text size="xs">{shareError}</Text>
          </Alert>
        )}
        <Button mt="md" fullWidth leftSection={<Share2 size={16} />} onClick={handleShare}>
          生成协作链接
        </Button>
        {shareText && (
          <>
            <Paper withBorder mt="md" p="sm">
              <Text size="xs" className="share-url">{shareText}</Text>
            </Paper>
            <Button
              mt="md"
              leftSection={<Clipboard size={16} />}
              fullWidth
              onClick={() => navigator.clipboard.writeText(shareText)}
            >
              复制链接
            </Button>
          </>
        )}
      </Modal>

      <ConflictResolutionModal
        opened={collab.status === 'conflict'}
        course={course}
        conflicts={collab.conflicts}
        onResolve={store.resolveConflict}
      />
    </div>
  );
}
