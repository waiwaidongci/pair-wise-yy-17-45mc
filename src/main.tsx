import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { courseFromShareToken } from './utils/course';
import { parseShareHash } from './utils/collab';
import { useCourseStore } from './stores/courseStore';
import './styles.css';

// 新版协作链接：打开即加入同一文档，断网也能接着改
const collabPayload = parseShareHash(window.location.hash);
if (collabPayload) {
  const outcome = useCourseStore.getState().ingestSharePayload(collabPayload);
  if (outcome.status === 'failed') {
    window.setTimeout(() => alert(outcome.error), 0);
  }
  window.history.replaceState(null, '', window.location.pathname);
} else {
  // 兼容旧版静态快照链接（只读快照，无法回并）
  const shared = window.location.hash.match(/course=([^&]+)/)?.[1];
  if (shared) {
    const sharedCourse = courseFromShareToken(decodeURIComponent(shared));
    if (sharedCourse) {
      useCourseStore.getState().loadCourse(sharedCourse);
    }
    window.history.replaceState(null, '', window.location.pathname);
  }
}

// 另一个标签页（模拟另一台设备/另一位教练）发布了新版本时，自动发现并提示可合并
window.addEventListener('storage', (event) => {
  if (event.key !== 'strideplan:shared-boards') return;
  const store = useCourseStore.getState();
  const session = store.session;
  if (!session) return;
  const before = session.remoteRev;
  store.refreshRemote();
  const after = useCourseStore.getState().session?.remoteRev ?? before;
  if (after > before && session.online) {
    const baseCourse = useCourseStore.getState().session?.baseCourse;
    const untouched =
      baseCourse &&
      JSON.stringify(useCourseStore.getState().course) === JSON.stringify(baseCourse);
    if (untouched) {
      const outcome = store.pullRemote();
      if (outcome.status === 'fast-forwarded' || outcome.status === 'merged') {
        window.dispatchEvent(new CustomEvent('sp:remote-merged', { detail: outcome }));
      }
    } else {
      window.dispatchEvent(new CustomEvent('sp:remote-available', { detail: { rev: after } }));
    }
  }
});

const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
  headings: { fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif' },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <RouterProvider router={router} />
    </MantineProvider>
  </React.StrictMode>,
);

