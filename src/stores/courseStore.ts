import { create } from 'zustand';
import type {
  Course,
  Obstacle,
  ObstaclePreset,
  RouteAnalysis,
  SavedRoute,
} from '../types/course';
import {
  analyzeCourse,
  clamp,
  createInitialCourse,
  createObstacle,
  generateRouteOptions,
  roundTo,
} from '../utils/course';
import {
  createSessionId,
  deepEqual,
  mergeCourses,
  type CollaborationEnvelope,
  type CollabConflict,
} from '../utils/collab';

const COURSE_KEY = 'strideplan:course';
const SAVED_KEY = 'strideplan:saved-routes';
const COLLAB_KEY = 'strideplan:collab';

function cloneCourse(course: Course): Course {
  return structuredClone(course);
}

function readCourse() {
  try {
    const raw = localStorage.getItem(COURSE_KEY);
    return raw ? (JSON.parse(raw) as Course) : createInitialCourse();
  } catch {
    return createInitialCourse();
  }
}

export function readSavedRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedRoute[]) : [];
  } catch {
    return [];
  }
}

function persist(course: Course, savedRoutes?: SavedRoute[]) {
  localStorage.setItem(COURSE_KEY, JSON.stringify(course));
  if (savedRoutes) localStorage.setItem(SAVED_KEY, JSON.stringify(savedRoutes));
}

/**
 * 协作会话状态。baseCourse/baseRevision 是双方上次同步的基线（三路合并的共同祖先），
 * localRevision 是本机已保存的最新版本，incoming 是打开链接收到的对方版本。
 */
export interface CollabState {
  sessionId: string | null;
  coachName: string;
  baseCourse: Course | null;
  baseRevision: number;
  localRevision: number;
  incoming: CollaborationEnvelope | null;
  incomingDismissed: boolean;
  conflicts: CollabConflict[];
  status: 'idle' | 'incoming' | 'conflict' | 'merged' | 'merge-failed';
  lastError: string | null;
  preMerge: { course: Course; envelope: CollaborationEnvelope } | null;
  lastMergedAt: number | null;
  dirty: boolean;
}

function initialCollab(): CollabState {
  return {
    sessionId: null,
    coachName: '',
    baseCourse: null,
    baseRevision: 0,
    localRevision: 0,
    incoming: null,
    incomingDismissed: false,
    conflicts: [],
    status: 'idle',
    lastError: null,
    preMerge: null,
    lastMergedAt: null,
    dirty: false,
  };
}

function readCollab(): CollabState {
  try {
    const raw = localStorage.getItem(COLLAB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CollabState>;
      return { ...initialCollab(), ...parsed, coachName: parsed.coachName ?? '' };
    }
  } catch {
    // 协作状态损坏时从头开始，不影响路线数据
  }
  return initialCollab();
}

function persistCollab(collab: CollabState) {
  localStorage.setItem(COLLAB_KEY, JSON.stringify(collab));
}

interface CourseState {
  course: Course;
  selectedId: string | null;
  snapEnabled: boolean;
  gridVisible: boolean;
  routeOptions: ReturnType<typeof import('../utils/course').generateRouteOptions>;
  savedRoutes: SavedRoute[];
  history: Course[];
  future: Course[];
  analysis: RouteAnalysis;
  analysisStale: boolean;
  collab: CollabState;
  select: (id: string | null) => void;
  toggleSnap: () => void;
  toggleGrid: () => void;
  addObstacle: (preset: ObstaclePreset, x: number, y: number) => void;
  updateObstacle: (id: string, patch: Partial<Obstacle>) => void;
  moveObstacle: (id: string, x: number, y: number) => void;
  removeObstacle: (id: string) => void;
  moveInSequence: (id: string, direction: -1 | 1) => void;
  setCourseName: (name: string) => void;
  setArena: (patch: Partial<Course['arena']>) => void;
  setHorse: (patch: Partial<Course['horse']>) => void;
  setGridSize: (size: number) => void;
  applyRoute: (sequence: string[]) => void;
  generateOptions: () => void;
  undo: () => void;
  redo: () => void;
  resetCourse: () => void;
  loadCourse: (course: Course) => void;
  saveNamedRoute: (name: string) => SavedRoute;
  deleteSavedRoute: (id: string) => void;
  recomputeAnalysis: () => void;
  setCoachName: (name: string) => void;
  openSharedEnvelope: (envelope: CollaborationEnvelope) => void;
  buildShareEnvelope: () => { ok: true; envelope: CollaborationEnvelope } | { ok: false; reason: string };
  mergeIncoming: () => void;
  retryMerge: () => void;
  dismissIncoming: () => void;
  resolveConflict: (conflictId: string, choice: 'ours' | 'theirs') => void;
}

export const useCourseStore = create<CourseState>((set, get) => {
  const initial = readCourse();
  const initialAnalysis = analyzeCourse(initial);

  const commit = (nextCourse: Course) => {
    const current = get().course;
    const next = { ...cloneCourse(nextCourse), updatedAt: Date.now() };
    persist(next, get().savedRoutes);
    set((state) => ({
      course: next,
      history: [...state.history.slice(-39), cloneCourse(current)],
      future: [],
      analysisStale: true,
      collab: { ...state.collab, dirty: true },
    }));
    persistCollab(get().collab);
  };

  const applyFreshCourse = (course: Course) => {
    const analysis = analyzeCourse(course);
    set({
      course,
      analysis,
      analysisStale: false,
      history: [],
      future: [],
      selectedId: course.sequence[0] ?? null,
      routeOptions: [],
    });
    persist(course, get().savedRoutes);
  };

  // 三路合并的核心：ours 是本机工作副本，incoming 是对方版本，base 是共同基线。
  const performMerge = (ours: Course, incoming: CollaborationEnvelope, base: Course) => {
    try {
      if (incoming.sessionId !== get().collab.sessionId) {
        throw new Error('协作会话不匹配，无法合并。');
      }
      const theirs = incoming.course;
      if (deepEqual(ours, theirs)) {
        const next: CollabState = {
          ...get().collab,
          baseCourse: cloneCourse(ours),
          baseRevision: incoming.revision,
          localRevision: Math.max(get().collab.localRevision, incoming.revision),
          incoming: null,
          incomingDismissed: false,
          status: 'merged',
          conflicts: [],
          preMerge: null,
          lastError: null,
          lastMergedAt: Date.now(),
          dirty: false,
        };
        set({ collab: next });
        persistCollab(next);
        return;
      }
      const { course: merged, conflicts } = mergeCourses(base, ours, theirs, incoming.revision);
      const revision = Math.max(get().collab.localRevision, incoming.revision) + 1;
      const next: CollabState = {
        ...get().collab,
        baseCourse: cloneCourse(merged),
        baseRevision: revision,
        localRevision: revision,
        incoming: null,
        incomingDismissed: false,
        conflicts,
        status: conflicts.length ? 'conflict' : 'merged',
        preMerge: { course: cloneCourse(ours), envelope: incoming },
        lastError: null,
        lastMergedAt: Date.now(),
        dirty: false,
      };
      set({
        course: merged,
        selectedId: merged.sequence[0] ?? null,
        analysisStale: true,
        collab: next,
      });
      persist(merged, get().savedRoutes);
      persistCollab(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : '合并失败，请重试。';
      const next: CollabState = {
        ...get().collab,
        status: 'merge-failed',
        lastError: message,
        preMerge: { course: cloneCourse(ours), envelope: incoming },
      };
      set({ collab: next });
      persistCollab(next);
    }
  };

  return {
    course: initial,
    selectedId: initial.sequence[0] ?? null,
    snapEnabled: true,
    gridVisible: true,
    routeOptions: [],
    savedRoutes: readSavedRoutes(),
    history: [],
    future: [],
    analysis: initialAnalysis,
    analysisStale: false,
    collab: readCollab(),

    select: (id) => set({ selectedId: id }),
    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
    toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
    addObstacle: (preset, x, y) => {
      const current = get().course;
      const nextNumber = current.obstacles.length + 1;
      const obstacle = createObstacle(
        preset,
        clamp(roundTo(x, 0.5), 2, current.arena.width - 2),
        clamp(roundTo(y, 0.5), 2, current.arena.length - 2),
        nextNumber,
      );
      commit({
        ...current,
        obstacles: [...current.obstacles, obstacle],
        sequence: [...current.sequence, obstacle.id],
      });
      set({ selectedId: obstacle.id });
    },
    updateObstacle: (id, patch) => {
      const current = get().course;
      commit({
        ...current,
        obstacles: current.obstacles.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    },
    moveObstacle: (id, x, y) => {
      const current = get().course;
      const snap = get().snapEnabled ? current.gridSize : 0.1;
      commit({
        ...current,
        obstacles: current.obstacles.map((item) =>
          item.id === id
            ? {
                ...item,
                x: clamp(roundTo(x, snap), 1, current.arena.width - 1),
                y: clamp(roundTo(y, snap), 1, current.arena.length - 1),
              }
            : item,
        ),
      });
    },
    removeObstacle: (id) => {
      const current = get().course;
      commit({
        ...current,
        obstacles: current.obstacles.filter((item) => item.id !== id),
        sequence: current.sequence.filter((item) => item !== id),
      });
      set({ selectedId: null });
    },
    moveInSequence: (id, direction) => {
      const current = get().course;
      const index = current.sequence.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.sequence.length) return;
      const sequence = [...current.sequence];
      [sequence[index], sequence[nextIndex]] = [sequence[nextIndex], sequence[index]];
      commit({ ...current, sequence });
    },
    setCourseName: (name) => commit({ ...get().course, name }),
    setArena: (patch) =>
      commit({
        ...get().course,
        arena: { ...get().course.arena, ...patch },
      }),
    setHorse: (patch) =>
      commit({
        ...get().course,
        horse: { ...get().course.horse, ...patch },
      }),
    setGridSize: (gridSize) => commit({ ...get().course, gridSize }),
    applyRoute: (sequence) => {
      commit({ ...get().course, sequence });
      set({ routeOptions: [] });
    },
    generateOptions: () => {
      set({ routeOptions: generateRouteOptions(get().course) });
    },
    undo: () => {
      const { history, course } = get();
      if (!history.length) return;
      const previous = history[history.length - 1];
      set({
        course: previous,
        history: history.slice(0, -1),
        future: [course, ...get().future],
        analysisStale: true,
        collab: { ...get().collab, dirty: true },
      });
      persist(previous, get().savedRoutes);
      persistCollab(get().collab);
    },
    redo: () => {
      const { future, course } = get();
      if (!future.length) return;
      const next = future[0];
      set({
        course: next,
        future: future.slice(1),
        history: [...get().history, course],
        analysisStale: true,
        collab: { ...get().collab, dirty: true },
      });
      persist(next, get().savedRoutes);
      persistCollab(get().collab);
    },
    resetCourse: () => {
      const course = createInitialCourse();
      const analysis = analyzeCourse(course);
      const collab = { ...initialCollab(), coachName: get().collab.coachName };
      set({
        course,
        analysis,
        analysisStale: false,
        history: [],
        future: [],
        selectedId: course.sequence[0],
        routeOptions: [],
        collab,
      });
      persist(course, get().savedRoutes);
      persistCollab(collab);
    },
    loadCourse: (course) => {
      const analysis = analyzeCourse(course);
      const collab = { ...initialCollab(), coachName: get().collab.coachName };
      set({
        course,
        analysis,
        analysisStale: false,
        history: [],
        future: [],
        selectedId: course.sequence[0] ?? null,
        routeOptions: [],
        collab,
      });
      persist(course, get().savedRoutes);
      persistCollab(collab);
    },
    saveNamedRoute: (name) => {
      const course = cloneCourse({ ...get().course, name });
      const analysis = analyzeCourse(course);
      const saved: SavedRoute = {
        id: course.id,
        name,
        savedAt: Date.now(),
        course,
        score: analysis.score,
      };
      const savedRoutes = [saved, ...get().savedRoutes.filter((item) => item.id !== saved.id)];
      set({ savedRoutes, course, analysis, analysisStale: false });
      persist(course, savedRoutes);
      return saved;
    },
    deleteSavedRoute: (id) => {
      const savedRoutes = get().savedRoutes.filter((item) => item.id !== id);
      set({ savedRoutes });
      persist(get().course, savedRoutes);
    },
    recomputeAnalysis: () => {
      set({ analysis: analyzeCourse(get().course), analysisStale: false });
    },
    setCoachName: (name) => {
      const next = { ...get().collab, coachName: name };
      set({ collab: next });
      persistCollab(next);
    },
    openSharedEnvelope: (envelope) => {
      const collab = get().collab;

      // 首次在本机打开该协作会话：直接作为工作副本，基线即此版本
      if (!collab.sessionId || collab.sessionId !== envelope.sessionId || !collab.baseCourse) {
        applyFreshCourse(envelope.course);
        const next: CollabState = {
          ...initialCollab(),
          coachName: collab.coachName,
          sessionId: envelope.sessionId,
          baseCourse: cloneCourse(envelope.course),
          baseRevision: envelope.revision,
          localRevision: envelope.revision,
          status: 'idle',
        };
        set({ collab: next });
        persistCollab(next);
        return;
      }

      // 同一会话：版本不高于基线，说明是旧链接或重复链接，忽略
      if (envelope.revision <= collab.baseRevision && envelope.revision <= collab.localRevision) {
        const next: CollabState = {
          ...collab,
          status: 'idle',
          lastError: '收到的是旧版本链接，已忽略。',
        };
        set({ collab: next });
        persistCollab(next);
        return;
      }

      // 对方版本不低于我方已保存版本，且本机没有未保存改动 → 快速跟进
      if (envelope.basedOn >= collab.localRevision && !collab.dirty) {
        applyFreshCourse(envelope.course);
        const next: CollabState = {
          ...collab,
          baseCourse: cloneCourse(envelope.course),
          baseRevision: envelope.revision,
          localRevision: envelope.revision,
          incoming: null,
          incomingDismissed: false,
          status: 'merged',
          lastError: null,
        };
        set({ collab: next });
        persistCollab(next);
        return;
      }

      // 需要三路合并：先挂起，由教练确认后执行
      const next: CollabState = {
        ...collab,
        incoming: envelope,
        incomingDismissed: false,
        status: 'incoming',
        lastError: null,
      };
      set({ collab: next });
      persistCollab(next);
    },
    buildShareEnvelope: () => {
      const collab = get().collab;
      if (collab.incoming) {
        return {
          ok: false,
          reason: collab.incomingDismissed
            ? '你有暂未处理的对方修改，请先完成合并或放弃，再生成新链接。'
            : '你有未合并的对方修改，请先合并再生成新链接，以免覆盖对方版本。',
        };
      }
      const revision = collab.localRevision + 1;
      const envelope: CollaborationEnvelope = {
        kind: 'strideplan-collab-1',
        sessionId: collab.sessionId ?? createSessionId(),
        revision,
        basedOn: collab.localRevision,
        author: collab.coachName.trim() || '教练',
        savedAt: Date.now(),
        course: cloneCourse(get().course),
      };
      const next: CollabState = {
        ...collab,
        sessionId: envelope.sessionId,
        baseCourse: collab.baseCourse ?? cloneCourse(get().course),
        baseRevision: collab.baseRevision || revision,
        localRevision: revision,
        incoming: null,
        status: 'idle',
        dirty: false,
        lastError: null,
      };
      set({ collab: next });
      persistCollab(next);
      return { ok: true, envelope };
    },
    mergeIncoming: () => {
      const collab = get().collab;
      const incoming = collab.incoming;
      if (!incoming || !collab.baseCourse) return;
      performMerge(get().course, incoming, collab.baseCourse);
    },
    retryMerge: () => {
      const collab = get().collab;
      const pre = collab.preMerge;
      if (!pre || !collab.baseCourse) return;
      performMerge(pre.course, pre.envelope, collab.baseCourse);
    },
    dismissIncoming: () => {
      const next: CollabState = { ...get().collab, incomingDismissed: true, status: 'idle' };
      set({ collab: next });
      persistCollab(next);
    },
    resolveConflict: (conflictId, choice) => {
      const collab = get().collab;
      const conflict = collab.conflicts.find((item) => item.id === conflictId);
      if (!conflict) return;
      const course = cloneCourse(get().course);
      if (conflict.kind === 'obstacle') {
        if (choice === 'theirs' && conflict.theirs) {
          const index = course.obstacles.findIndex((item) => item.id === conflict.obstacleId);
          if (index >= 0) course.obstacles[index] = structuredClone(conflict.theirs);
        }
        if (conflict.shadowId) {
          course.obstacles = course.obstacles.filter((item) => item.id !== conflict.shadowId);
          course.sequence = course.sequence.filter((id) => id !== conflict.shadowId);
        }
      } else if (conflict.kind === 'order') {
        const chosen = choice === 'theirs' ? conflict.theirs : conflict.ours;
        const shadows = course.sequence.filter((id) => id.includes('__conflict_'));
        course.sequence = [...chosen, ...shadows];
      } else if (conflict.kind === 'arena') {
        if (choice === 'theirs') course.arena = structuredClone(conflict.theirs as Course['arena']);
      } else if (conflict.kind === 'horse') {
        if (choice === 'theirs') course.horse = structuredClone(conflict.theirs as Course['horse']);
      }
      const conflicts = collab.conflicts.filter((item) => item.id !== conflictId);
      const next: CollabState = {
        ...collab,
        conflicts,
        status: conflicts.length ? 'conflict' : 'merged',
        dirty: true,
      };
      set({ course, analysisStale: true, collab: next });
      persist(course, get().savedRoutes);
      persistCollab(next);
    },
  };
});
