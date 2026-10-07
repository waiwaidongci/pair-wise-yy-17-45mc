import { Badge, Button, Group, Text, TextInput, Tooltip } from '@mantine/core';
import {
  CloudUpload,
  DownloadCloud,
  LogOut,
  RefreshCw,
  RotateCcw,
  Undo2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCourseStore } from '../stores/courseStore';

function toast(message: string, tone: 'info' | 'error' | 'success') {
  const node = document.createElement('div');
  node.className = `sp-toast sp-toast-${tone}`;
  node.textContent = message;
  document.body.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  window.setTimeout(() => {
    node.classList.remove('show');
    window.setTimeout(() => node.remove(), 260);
  }, 4200);
}

export function notify(message: string, tone: 'info' | 'error' | 'success' = 'info') {
  toast(message, tone);
}

export function CollabBar() {
  const session = useCourseStore((state) => state.session);
  const baseCourse = useCourseStore((state) => (state.session?.baseCourse ?? null));
  const course = useCourseStore((state) => state.course);
  const setOnline = useCourseStore((state) => state.setOnline);
  const pullRemote = useCourseStore((state) => state.pullRemote);
  const publishLocal = useCourseStore((state) => state.publishLocal);
  const retryMerge = useCourseStore((state) => state.retryMerge);
  const rollbackMerge = useCourseStore((state) => state.rollbackMerge);
  const dismissReport = useCourseStore((state) => state.dismissReport);
  const updatePeerName = useCourseStore((state) => state.updatePeerName);
  const leaveCollab = useCourseStore((state) => state.leaveCollab);
  const beginShare = useCourseStore((state) => state.beginShare);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [peerDraft, setPeerDraft] = useState(session?.peerName ?? '');

  useEffect(() => {
    const onMerged = () => notify('另一位教练的新版本已取回并并入。', 'success');
    const onAvailable = (event: Event) => {
      const rev = (event as CustomEvent<{ rev: number }>).detail.rev;
      notify(`对方保存了新版本 v${rev}，点“取回并合并”查看。`, 'info');
    };
    window.addEventListener('sp:remote-merged', onMerged);
    window.addEventListener('sp:remote-available', onAvailable);
    return () => {
      window.removeEventListener('sp:remote-merged', onMerged);
      window.removeEventListener('sp:remote-available', onAvailable);
    };
  }, []);

  const handleBegin = async () => {
    const url = beginShare();
    setShareUrl(url);
    setShareOpen(true);
    try {
      await navigator.clipboard.writeText(url);
      notify('协作已开启，续作链接已复制。', 'success');
    } catch {
      notify('协作已开启，复制下面的链接发给另一位教练。', 'info');
    }
  };

  if (!session) {
    return (
      <div className="collab-bar collab-off">
        <Group gap="sm">
          <Badge variant="light" color="gray">单机模式</Badge>
          <Text size="xs" c="dimmed">分享链接目前只是静态快照，对方的修改无法合并回来。</Text>
        </Group>
        <Button size="xs" variant="light" leftSection={<CloudUpload size={14} />} onClick={handleBegin}>
          开启可续作协作
        </Button>
        {shareOpen && (
          <div className="collab-share-pop">
            <Text size="xs" fw={800} mb={4}>把这条链接发给另一位教练：</Text>
            <Text size="xs" className="share-url">{shareUrl}</Text>
            <Group mt={6} gap="xs">
              <Button
                size="xs"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl).catch(() => undefined);
                  notify('链接已复制。', 'success');
                }}
              >
                复制链接
              </Button>
              <Button size="xs" variant="subtle" onClick={() => setShareOpen(false)}>收起</Button>
            </Group>
          </div>
        )}
      </div>
    );
  }

  const dirty = baseCourse ? JSON.stringify(course) !== JSON.stringify(baseCourse) : false;
  const report = session.lastReport;
  const error = session.lastError;

  const handlePull = () => {
    const outcome = pullRemote();
    if (outcome.status === 'fast-forwarded' || outcome.status === 'merged') {
      const report = useCourseStore.getState().session?.lastReport;
      if (report) notify(report.note, report.conflictCount > 0 ? 'error' : 'success');
      else notify('已取回对方的修改。', 'success');
    } else if (outcome.status === 'noop') {
      notify('共享盘上还没有新的修改。', 'info');
    } else {
      notify((outcome as { error: string }).error, 'error');
    }
  };

  const handlePublish = () => {
    const outcome = publishLocal();
    if (outcome.status === 'published') {
      notify(`已保存到共享盘（版本 v${outcome.rev}）。把最新链接发给对方即可续作。`, 'success');
    } else if (outcome.status === 'conflict') {
      notify(`对方的保存先成立（v${outcome.currentRev}），本次保存没有写入。请先“取回并合并”再保存。`, 'error');
    } else {
      notify(outcome.error, 'error');
    }
  };

  const handleRetry = () => {
    const outcome = retryMerge();
    if (outcome.status === 'merged') {
      const r = useCourseStore.getState().session?.lastReport;
      notify(r?.note ?? '已基于合并前那版重新合并。', outcome.conflicts && outcome.conflicts.length > 0 ? 'error' : 'success');
    } else if (outcome.status === 'failed' || outcome.status === 'offline' || outcome.status === 'missing') {
      notify(outcome.error, 'error');
    }
  };

  return (
    <>
      <div className={`collab-bar ${session.online ? 'collab-on' : 'collab-disconnected'}`}>
        <Group gap="sm" wrap="nowrap">
          <Tooltip label={session.online ? '点击模拟断网' : '点击恢复联网'}>
            <Button
              size="xs"
              variant={session.online ? 'light' : 'filled'}
              color={session.online ? 'teal' : 'orange'}
              leftSection={session.online ? <Wifi size={14} /> : <WifiOff size={14} />}
              onClick={() => {
                const outcome = setOnline(!session.online);
                if (!session.online && outcome.status === 'merged') {
                  const r = useCourseStore.getState().session?.lastReport;
                  notify(r?.note ?? '回网后已自动合并。', r?.conflictCount ? 'error' : 'success');
                }
              }}
            >
              {session.online ? '联网中' : '断网中'}
            </Button>
          </Tooltip>
          <TextInput
            size="xs"
            className="collab-name-input"
            value={peerDraft}
            aria-label="我的教练署名"
            onChange={(event) => setPeerDraft(event.currentTarget.value)}
            onBlur={() => {
              updatePeerName(peerDraft);
            }}
          />
          <Badge variant="light" color={dirty ? 'yellow' : 'teal'}>
            {dirty ? '本机有未保存调整' : '与共享盘一致'}
          </Badge>
          <Badge variant="light" color={session.remoteAvailable ? 'indigo' : 'gray'}>
            共享盘 v{session.remoteRev}
            {session.baseRev !== session.remoteRev ? ` · 基线 v${session.baseRev}` : ''}
          </Badge>
          {!session.remoteAvailable && (
            <Text size="xs" c="orange">读不到共享盘，可用对方发来的链接合并</Text>
          )}
        </Group>

        <Group gap={6} wrap="nowrap">
          <Tooltip label="取回共享盘上的新修改并与本机调整合并">
            <Button
              size="xs"
              variant="default"
              leftSection={<DownloadCloud size={14} />}
              onClick={handlePull}
              disabled={!session.online}
            >
              取回并合并
            </Button>
          </Tooltip>
          <Tooltip label="把本机调整保存到共享盘；两人同时保存时只有一份成立">
            <Button
              size="xs"
              leftSection={<CloudUpload size={14} />}
              onClick={handlePublish}
              disabled={!session.online || session.conflicts.length > 0}
              color="indigo"
            >
              保存到共享
            </Button>
          </Tooltip>
          <Tooltip label="退出协作，路线保留在本机继续单机编辑">
            <Button size="xs" variant="subtle" color="gray" leftSection={<LogOut size={14} />} onClick={leaveCollab}>
              退出
            </Button>
          </Tooltip>
        </Group>
      </div>

      {report && (
        <div className={`collab-banner ${report.conflictCount > 0 ? 'banner-conflict' : 'banner-ok'}`}>
          <div className="banner-body">
            <Text size="sm" fw={800}>
              {report.conflictCount > 0
                ? `合并完成：${report.conflictCount} 处两边都改过，已保留两版`
                : '合并完成：没有冲突'}
            </Text>
            <Text size="xs" className="banner-detail">{report.note}</Text>
            {report.mergedLabels.length > 0 && (
              <Text size="xs" className="banner-merged">
                已并入：{report.mergedLabels.slice(0, 8).join('、')}
                {report.mergedLabels.length > 8 ? ` 等 ${report.mergedLabels.length} 项` : ''}
              </Text>
            )}
          </div>
          <Group gap={6} wrap="nowrap">
            {session.checkpoint && (
              <>
                <Tooltip label="放弃这次合并稿，回到合并前那版；之后可重新合并，已并入内容不会丢">
                  <Button size="xs" variant="default" leftSection={<Undo2 size={13} />} onClick={rollbackMerge}>
                    回到合并前
                  </Button>
                </Tooltip>
                <Tooltip label="从合并前那版重新合并，已做过的冲突裁决会保留">
                  <Button size="xs" variant="default" leftSection={<RefreshCw size={13} />} onClick={handleRetry}>
                    重试合并
                  </Button>
                </Tooltip>
              </>
            )}
            <Button size="xs" variant="subtle" onClick={dismissReport}>知道了</Button>
          </Group>
        </div>
      )}

      {error && (
        <div className="collab-banner banner-error">
          <Text size="xs" className="banner-detail">{error}</Text>
          <Group gap={6} wrap="nowrap">
            {session.checkpoint && (
              <>
                <Button size="xs" variant="default" leftSection={<RotateCcw size={13} />} onClick={handleRetry}>
                  从合并前重试
                </Button>
                <Button size="xs" variant="default" leftSection={<Undo2 size={13} />} onClick={rollbackMerge}>
                  回到合并前
                </Button>
              </>
            )}
          </Group>
        </div>
      )}
    </>
  );
}
