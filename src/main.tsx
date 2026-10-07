import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { decodeShareToken } from './utils/collab';
import { useCourseStore } from './stores/courseStore';
import './styles.css';

const shared = window.location.hash.match(/course=([^&]+)/)?.[1];
if (shared) {
  const decoded = decodeShareToken(decodeURIComponent(shared));
  if (decoded?.kind === 'envelope') {
    useCourseStore.getState().openSharedEnvelope(decoded.envelope);
    window.history.replaceState(null, '', window.location.pathname);
  } else if (decoded?.kind === 'legacy') {
    useCourseStore.getState().loadCourse(decoded.course);
    window.history.replaceState(null, '', window.location.pathname);
  }
}

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

