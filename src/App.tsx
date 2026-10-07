import { useEffect, useState } from 'react';
import { ActionIcon, Badge, Group, Tabs, Text, Tooltip } from '@mantine/core';
import { BookOpen, CloudOff, FilePenLine, GitMerge, RotateCcw, Wifi } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useCourseStore } from './stores/courseStore';

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

export default function App() {
  const location = useLocation();
  const resetCourse = useCourseStore((state) => state.resetCourse);
  const obstacles = useCourseStore((state) => state.course.obstacles.length);
  const collab = useCourseStore((state) => state.collab);
  const online = useOnline();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Group>
          <div className="brand-mark">SP</div>
          <div>
            <Text fw={900} className="brand-name">StridePlan</Text>
            <Text className="brand-subtitle">马术障碍路线设计器</Text>
          </div>
        </Group>
        <Tabs
          value={location.pathname.startsWith('/routes') ? 'routes' : 'designer'}
          variant="pills"
          className="main-nav"
        >
          <Tabs.List>
            <Tabs.Tab value="designer" leftSection={<FilePenLine size={16} />}>
              <Link to="/designer">路线设计</Link>
            </Tabs.Tab>
            <Tabs.Tab value="routes" leftSection={<BookOpen size={16} />}>
              <Link to="/routes">路线库</Link>
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Group gap="xs">
          {collab.status === 'conflict' && (
            <Badge variant="filled" color="red" leftSection={<GitMerge size={12} />}>
              {collab.conflicts.length} 处冲突待处理
            </Badge>
          )}
          {collab.incoming && collab.status !== 'conflict' && (
            <Badge variant="light" color="indigo" leftSection={<GitMerge size={12} />}>
              有对方修改待合并
            </Badge>
          )}
          <Tooltip label={online ? '在线：修改会保存在本机，收到对方链接后可合并' : '离线编辑中：修改保存在本机，回网后合并'}>
            <Badge variant="light" color={online ? 'teal' : 'gray'} leftSection={online ? <Wifi size={12} /> : <CloudOff size={12} />}>
              {online ? '在线' : '离线'}
            </Badge>
          </Tooltip>
          <Badge variant="light">{obstacles} 道障碍</Badge>
          <ActionIcon variant="subtle" color="gray" onClick={resetCourse} title="恢复示例路线">
            <RotateCcw size={18} />
          </ActionIcon>
        </Group>
      </header>
      <Outlet />
    </div>
  );
}
