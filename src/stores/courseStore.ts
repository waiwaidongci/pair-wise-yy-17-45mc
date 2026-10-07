import { create } from 'zustand';
import type {
  BoardRevision,
  CollabSession,
  ConflictRecord,
  ConflictSide,
  Course,
  Obstacle,
  ObstaclePreset,
  SavedRoute,
  SharePayload,
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
  appendRevisionCas,
  analysisSignature,
  applyConflictResolution,
  buildShareUrl,
  createBoard,
  getPeer,
  mergeCourses,
  readBoard,
  setPeerName as persistPeerName,
} from '../utils/collab';

const COURSE_KEY = 'strideplan:course';
const SAVED_KEY = 'strideplan:saved-routes';
const SESSION_KEY = 'strideplan:collab-session';
const ANALYSIS_KEY = 'strideplan:analysis-state';

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

function readSession(): CollabSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as CollabSession) : null;
  } catch {
    return null;
  }
}

interface AnalysisState {
  /** 上次完成重算（或载入）时的场地/步幅参数签名 */
  signature: string;
}

function readAnalysisState(): AnalysisState | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    if (raw) return JSON.parse(raw) as AnalysisState;
  } catch {
    // fall through
  }
  return null;
}

function isAnalysisStale(course: Course, signature: string | null) {
  return signature !== null && signature !== analysisSignature(course);
}

function persist(course: Course, savedRoutes?: SavedRoute[], session?: CollabSession | null, analysis?: AnalysisState | null) {
  localStorage.setItem(COURSE_KEY, JSON.stringify(course));
  if (savedRoutes) localStorage.setItem(SAVED_KEY, JSON.stringify(savedRoutes));
  if (session !== undefined) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }
  if (analysis !== undefined) {
    if (analysis) localStorage.setItem(ANALYSIS_KEY, JSON.stringify(analysis));
    else localStorage.removeItem(ANALYSIS_KEY);
  }
}

export type PullOutcome =
  | { status: 'noop' | 'fast-forwarded' | 'merged'; report?: CollabSession['lastReport']; conflicts?: ConflictRecord[] }
  | { status: 'offline' | 'missing' | 'failed'; error: string };

export type PublishOutcome =
  | { status: 'published'; rev: number }
  | { status: 'conflict'; currentRev: number }
  | { status: 'offline' | 'conflicts-open' | 'missing' | 'failed'; error: string };

export type IngestOutcome =
  | { status: 'joined'; docId: string; remoteRev: number }
  | { status: 'merged'; docId: string; report?: CollabSession['lastReport']; conflicts?: ConflictRecord[] }
  | { status: 'failed'; error: string };

interface CourseState {
  course: Course;
  selectedId: string | null;
  snapEnabled: boolean;
  gridVisible: boolean;
  routeOptions: ReturnType<typeof import('../utils/course').generateRouteOptions>;
  savedRoutes: SavedRoute[];
  history: Course[];
  future: Course[];
  session: CollabSession | null;
  analysisStale: boolean;
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
  beginShare: () => string;
  ingestSharePayload: (payload: SharePayload) => IngestOutcome;
  refreshRemote: () => void;
  setOnline: (online: boolean) => PullOutcome;
  pullRemote: () => PullOutcome;
  publishLocal: () => PublishOutcome;
  resolveConflict: (conflictId: string, side: ConflictSide) => void;
  retryMerge: () => PullOutcome;
  rollbackMerge: () => void;
  dismissReport: () => void;
  updatePeerName: (name: string) => void;
  leaveCollab: () => void;
}

export const useCourseStore = create<CourseState>((set, get) => {
  const initial = readCourse();

  /** 本地改稿入口：记撤销栈；步数表与稳定度按场地/步幅签名自动判定失效。 */
  const commit = (nextCourse: Course) => {
    const current = get().course;
    const next = { ...cloneCourse(nextCourse), updatedAt: Date.now() };
    const previous = readAnalysisState();
    const analysis: AnalysisState = previous ?? { signature: analysisSignature(next) };
    persist(next, get().savedRoutes, get().session, analysis);
    set((state) => ({
      course: next,
      analysisStale: isAnalysisStale(next, analysis.signature),
      history: [...state.history.slice(-39), cloneCourse(current)],
      future: [],
    }));
  };

  const saveSession = (session: CollabSession | null) => {
    persist(get().course, get().savedRoutes, session);
    set({ session });
  };

  const clearSession = () => saveSession(null);

  /** 把合并/快进/裁决产生的路线写进 store；并入的路线步数表一律视为待重算。 */
  const adoptMergedCourse = (course: Course, session: CollabSession, clearHistory = false) => {
    const next = { ...cloneCourse(course), updatedAt: Date.now() };
    // 保留旧签名，使 analysisStale 自动为真，直到用户点“重新计算”
    const previous = readAnalysisState();
    const analysis: AnalysisState = previous ?? { signature: '' };
    persist(next, get().savedRoutes, session, analysis);
    set((state) => ({
      course: next,
      session,
      analysisStale: isAnalysisStale(next, analysis.signature),
      history: clearHistory ? [] : [...state.history.slice(-39), cloneCourse(get().course)],
      future: [],
    }));
  };

  const buildSessionFromBoard = (
    docId: string,
    baseRev: number,
    baseCourse: Course,
  ): CollabSession => {
    const peer = getPeer();
    return {
      docId,
      peerId: peer.id,
      peerName: peer.name,
      online: true,
      baseRev,
      baseCourse: cloneCourse(baseCourse),
      remoteRev: baseRev,
      remoteAvailable: true,
      conflicts: [],
      checkpoint: null,
      lastReport: null,
      lastError: null,
    };
  };

  /** 拉取并合并共享盘最新版；返回合并报告供 UI 提示。 */
  const mergeWithBoardHead = (
    session: CollabSession,
    options?: { useCheckpoint?: boolean },
  ): PullOutcome => {
    if (!session.online) return { status: 'offline', error: '当前处于断网状态，无法取回对方修改。' };
    const board = readBoard(session.docId);
    if (!board) {
      return {
        status: 'missing',
        error: '共享盘上找不到这份路线（可能在另一台设备上），可以用对方发来的新链接继续合并。',
      };
    }
    const head = board.revisions[board.revisions.length - 1];
    if (head.rev <= session.remoteRev && !options?.useCheckpoint) {
      return { status: 'noop' };
    }

    let localCourse: Course;
    let baseCourse: Course | null;
    if (options?.useCheckpoint && session.checkpoint) {
      // 从合并前那版重试：起点是合并前的本地稿，已并入部分通过对方版本重新并入
      const cp = session.checkpoint;
      localCourse = cloneCourse(cp.localCourse);
      baseCourse = cp.baseCourse ? cloneCourse(cp.baseCourse) : null;
      // 已经手动裁决过的选择直接重放，重试不丢裁决
      cp.conflicts.forEach((conflict) => {
        if (conflict.chosen) localCourse = applyConflictResolution(localCourse, conflict, conflict.chosen);
      });
    } else {
      localCourse = cloneCourse(get().course);
      baseCourse = session.baseCourse ? cloneCourse(session.baseCourse) : null;
    }

    const remoteCourse = cloneCourse(head.course);
    let merged;
    try {
      merged = mergeCourses(baseCourse, localCourse, remoteCourse);
    } catch (error) {
      const failed: CollabSession = {
        ...session,
        lastError: `合并失败：${error instanceof Error ? error.message : '未知错误'}，可从合并前那版重试。`,
      };
      saveSession(failed);
      return { status: 'failed', error: failed.lastError ?? '合并失败' };
    }

    const { course: mergedCourseRaw, conflicts: freshConflicts, mergedLabels } = merged;

    // 重试时：已在检查点里裁决过的冲突直接重放到合并稿，不再要求二次裁决
    let mergedCourse = mergedCourseRaw;
    let conflicts = freshConflicts;
    if (options?.useCheckpoint && session.checkpoint) {
      const chosenById = new Map(
        session.checkpoint.conflicts.filter((item) => item.chosen).map((item) => [item.id, item]),
      );
      conflicts = freshConflicts.filter((item) => !chosenById.has(item.id));
      chosenById.forEach((resolved) => {
        mergedCourse = applyConflictResolution(mergedCourse, { ...resolved, chosen: undefined }, resolved.chosen!);
      });
    }

    const report = {
      at: Date.now(),
      mergedLabels,
      conflictCount: conflicts.length,
      note:
        conflicts.length > 0
          ? `已自动并入 ${mergedLabels.length} 处无冲突调整，${conflicts.length} 处两边都改过，已保留两版待裁决。`
          : `对方的 ${mergedLabels.length || head.rev - session.baseRev} 处调整已全部并入。`,
    };

    const localTouched = JSON.stringify(localCourse) !== JSON.stringify(baseCourse);
    const nextSession: CollabSession = {
      ...session,
      remoteRev: head.rev,
      conflicts,
      lastReport: report,
      lastError: null,
      checkpoint:
        localTouched || options?.useCheckpoint
          ? {
              at: Date.now(),
              localCourse: cloneCourse(localCourse),
              remoteCourse,
              baseCourse: baseCourse ? cloneCourse(baseCourse) : null,
              prevBaseRev: session.baseRev,
              remoteRev: head.rev,
              conflicts,
              report,
            }
          : null,
      // 有冲突时基线停在旧版，裁决发布后才前进，保证对方内容不会丢
      baseRev: conflicts.length > 0 ? session.baseRev : head.rev,
      baseCourse: conflicts.length > 0 ? session.baseCourse : cloneCourse(remoteCourse),
    };

    adoptMergedCourse(mergedCourse, nextSession);
    return { status: 'merged', report, conflicts };
  };

  const initialSession = readSession();
  const initialAnalysisSignature = readAnalysisState()?.signature ?? analysisSignature(initial);

  return {
    course: initial,
    selectedId: initial.sequence[0] ?? null,
    snapEnabled: true,
    gridVisible: true,
    routeOptions: [],
    savedRoutes: readSavedRoutes(),
    history: [],
    future: [],
    session: initialSession,
    analysisStale: isAnalysisStale(initial, initialAnalysisSignature),
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
      const snap = current.gridSize;
      commit({
        ...current,
        obstacles: current.obstacles.map((item) =>
          item.id === id
            ? {
                ...item,
                x: clamp(roundTo(x, get().snapEnabled ? snap : 0.1), 1, current.arena.width - 1),
                y: clamp(roundTo(y, get().snapEnabled ? snap : 0.1), 1, current.arena.length - 1),
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
    setArena: (patch) => {
      commit({ ...get().course, arena: { ...get().course.arena, ...patch } });
    },
    setHorse: (patch) => {
      commit({ ...get().course, horse: { ...get().course.horse, ...patch } });
    },
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
      const signature = readAnalysisState()?.signature ?? analysisSignature(previous);
      set({
        course: previous,
        history: history.slice(0, -1),
        future: [course, ...get().future],
        analysisStale: isAnalysisStale(previous, signature),
      });
      persist(previous, get().savedRoutes, get().session, { signature });
    },
    redo: () => {
      const { future, course } = get();
      if (!future.length) return;
      const next = future[0];
      const signature = readAnalysisState()?.signature ?? analysisSignature(next);
      set({
        course: next,
        future: future.slice(1),
        history: [...get().history, course],
        analysisStale: isAnalysisStale(next, signature),
      });
      persist(next, get().savedRoutes, get().session, { signature });
    },
    resetCourse: () => {
      const course = createInitialCourse();
      clearSession();
      const analysis: AnalysisState = { signature: analysisSignature(course) };
      set({
        course,
        history: [],
        future: [],
        selectedId: course.sequence[0],
        routeOptions: [],
        session: null,
        analysisStale: false,
      });
      persist(course, get().savedRoutes, null, analysis);
    },
    loadCourse: (course) => {
      const analysis: AnalysisState = { signature: analysisSignature(course) };
      set({
        course,
        history: [],
        future: [],
        selectedId: course.sequence[0] ?? null,
        routeOptions: [],
        session: null,
        analysisStale: false,
      });
      persist(course, get().savedRoutes, null, analysis);
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
      const signature = readAnalysisState()?.signature ?? analysisSignature(course);
      set({ savedRoutes, course, analysisStale: isAnalysisStale(course, signature) });
      persist(course, savedRoutes, get().session, { signature });
      return saved;
    },
    deleteSavedRoute: (id) => {
      const savedRoutes = get().savedRoutes.filter((item) => item.id !== id);
      set({ savedRoutes });
      persist(get().course, savedRoutes, get().session, readAnalysisState());
    },
    recomputeAnalysis: () => {
      const analysis: AnalysisState = { signature: analysisSignature(get().course) };
      persist(get().course, get().savedRoutes, get().session, analysis);
      set({ analysisStale: false });
    },

    /* ------------------------------ 协作 ------------------------------ */

    beginShare: () => {
      const current = get().course;
      const peer = getPeer();
      const docId = createBoardId();
      const revision: BoardRevision = {
        rev: 1,
        authorId: peer.id,
        authorName: peer.name,
        at: Date.now(),
        course: cloneCourse(current),
      };
      createBoard(docId, current.name, revision);
      const session: CollabSession = {
        docId,
        peerId: peer.id,
        peerName: peer.name,
        online: true,
        baseRev: 1,
        baseCourse: cloneCourse(current),
        remoteRev: 1,
        remoteAvailable: true,
        conflicts: [],
        checkpoint: null,
        lastReport: null,
        lastError: null,
      };
      saveSession(session);
      return buildShareUrl({ v: 2, docId, rev: 1, from: peer.name, course: cloneCourse(current) });
    },

    ingestSharePayload: (payload) => {
      const existing = get().session;

      // 已在同一协作里：链接是对方发来的“新修订”，按拉取/合并处理
      if (existing && existing.docId === payload.docId) {
        const board = readBoard(payload.docId);
        let session: CollabSession = existing;
        if (board) {
          const head = board.revisions[board.revisions.length - 1];
          if (head.rev > existing.remoteRev) {
            const outcome = mergeWithBoardHead({ ...existing, online: true });
            if (outcome.status === 'offline' || outcome.status === 'missing' || outcome.status === 'failed') {
              return { status: 'failed', docId: payload.docId, error: outcome.error };
            }
            return {
              status: 'merged',
              docId: payload.docId,
              report: get().session?.lastReport ?? undefined,
              conflicts: get().session?.conflicts,
            };
          }
          session = { ...existing, remoteRev: head.rev, remoteAvailable: true };
        } else {
          session = { ...existing, remoteAvailable: false };
        }

        // 盘上拿不到（跨设备）或链接比本地新：以链接携带的路线作为远端版本合并。
        // 基线优先取会话里的 baseCourse（共同祖先）；只有全新文档才退化为两路保守合并。
        if (payload.rev > session.remoteRev || !board) {
          const localCourse = cloneCourse(get().course);
          const baseCourse = session.baseCourse ? cloneCourse(session.baseCourse) : null;
          const { course: mergedCourse, conflicts, mergedLabels } = mergeCourses(
            baseCourse,
            localCourse,
            cloneCourse(payload.course),
          );
          const report = {
            at: Date.now(),
            mergedLabels,
            conflictCount: conflicts.length,
            note:
              conflicts.length > 0
                ? `已自动并入 ${mergedLabels.length} 处无冲突调整，${conflicts.length} 处两边都改过，已保留两版待裁决。`
                : `对方的调整已全部并入（${mergedLabels.length} 处）。`,
          };
          const nextSession: CollabSession = {
            ...session,
            remoteRev: Math.max(session.remoteRev, payload.rev),
            baseRev: conflicts.length > 0 ? session.baseRev : payload.rev,
            baseCourse: conflicts.length > 0 ? session.baseCourse : cloneCourse(payload.course),
            conflicts,
            lastReport: report,
            lastError: null,
            checkpoint: {
              at: Date.now(),
              localCourse,
              remoteCourse: cloneCourse(payload.course),
              baseCourse,
              prevBaseRev: session.baseRev,
              remoteRev: payload.rev,
              conflicts,
              report,
            },
          };
          adoptMergedCourse(mergedCourse, nextSession);
          return { status: 'merged', docId: payload.docId, report, conflicts };
        }
        saveSession(session);
        return { status: 'merged', docId: payload.docId, report: existing.lastReport ?? undefined, conflicts: existing.conflicts };
      }

      // 盘上已有这份文档（同机另一位教练 / 另一个标签页）：直接加入并取最新版
      const board = readBoard(payload.docId);
      if (board) {
        const head = board.revisions[board.revisions.length - 1];
        const session = buildSessionFromBoard(payload.docId, head.rev, head.course);
        const analysis: AnalysisState = { signature: analysisSignature(head.course) };
        set({
          course: cloneCourse(head.course),
          selectedId: head.course.sequence[0] ?? null,
          session,
          analysisStale: false,
          history: [],
          future: [],
          routeOptions: [],
        });
        persist(head.course, get().savedRoutes, session, analysis);
        return { status: 'joined', docId: payload.docId, remoteRev: head.rev };
      }

      // 跨设备、本机没有盘：用链接里的路线建立本地会话，可断网续作，
      // 回网后通过对方再发的链接或同一共享盘合并
      const session = buildSessionFromBoard(payload.docId, payload.rev, payload.course);
      session.remoteAvailable = false;
      session.baseRev = payload.rev;
      session.baseCourse = cloneCourse(payload.course);
      const course = cloneCourse(payload.course);
      const analysis: AnalysisState = { signature: analysisSignature(course) };
      set({
        course,
        selectedId: course.sequence[0] ?? null,
        session,
        analysisStale: false,
        history: [],
        future: [],
        routeOptions: [],
      });
      persist(course, get().savedRoutes, session, analysis);
      return { status: 'joined', docId: payload.docId, remoteRev: payload.rev };
    },

    refreshRemote: () => {
      const session = get().session;
      if (!session) return;
      const board = readBoard(session.docId);
      if (!board) {
        saveSession({ ...session, remoteAvailable: false });
        return;
      }
      const head = board.revisions[board.revisions.length - 1];
      saveSession({ ...session, remoteAvailable: true, remoteRev: Math.max(session.remoteRev, head.rev) });
    },

    setOnline: (online) => {
      const session = get().session;
      if (!session) {
        return { status: 'offline', error: '尚未开启协作。' };
      }
      const next = { ...session, online };
      saveSession(next);
      if (!online) return { status: 'noop' };
      return get().pullRemote();
    },

    pullRemote: () => {
      const session = get().session;
      if (!session) return { status: 'missing', error: '尚未开启协作。' };
      const board = readBoard(session.docId);
      if (!board) {
        saveSession({ ...session, remoteAvailable: false });
        return {
          status: 'missing',
          error: '这台设备上读不到共享盘，请让对方重新发一次分享链接来取回修改。',
        };
      }
      const head = board.revisions[board.revisions.length - 1];
      const synced = { ...session, remoteAvailable: true };
      if (head.rev <= session.remoteRev) {
        saveSession({ ...synced, remoteRev: head.rev });
        return { status: 'noop' };
      }
      saveSession({ ...synced, remoteRev: head.rev });
      // 本地没动过：快进即可
      if (session.baseCourse && JSON.stringify(get().course) === JSON.stringify(session.baseCourse)) {
        const nextSession: CollabSession = {
          ...synced,
          baseRev: head.rev,
          baseCourse: cloneCourse(head.course),
          remoteRev: head.rev,
          lastReport: {
            at: Date.now(),
            mergedLabels: [],
            conflictCount: 0,
            note: '已同步对方最新版本。',
          },
          lastError: null,
        };
        adoptMergedCourse(head.course, nextSession, true);
        return { status: 'fast-forwarded', report: nextSession.lastReport };
      }
      return mergeWithBoardHead(synced);
    },

    publishLocal: () => {
      const session = get().session;
      if (!session) return { status: 'missing', error: '尚未开启协作。' };
      if (!session.online) return { status: 'offline', error: '断网中，修改已保存在本机；回网后会先合并再保存。' };
      if (session.conflicts.length > 0) {
        return { status: 'conflicts-open', error: `还有 ${session.conflicts.length} 处冲突未裁决，先保留两版的障碍/参数不能保存。` };
      }
      const board = readBoard(session.docId);
      if (!board) {
        return {
          status: 'missing',
          error: '这台设备上没有共享盘，无法直接保存；请用对方发来的链接合并后再发布。',
        };
      }
      const result = appendRevisionCas(session.docId, session.remoteRev, {
        authorId: session.peerId,
        authorName: session.peerName,
        at: Date.now(),
        course: cloneCourse(get().course),
      });
      if (!result.ok) {
        // 两人同时保存：只有一份成立，败者拿到新版本号，先合并再重试
        saveSession({
          ...session,
          remoteRev: result.currentRev,
          lastError: `对方的保存刚刚先成立（v${result.currentRev}），本次保存未写入。请先点“取回并合并”，再重新保存。`,
        });
        return { status: 'conflict', currentRev: result.currentRev };
      }
      const head = result.board.revisions[result.board.revisions.length - 1];
      const nextSession: CollabSession = {
        ...session,
        baseRev: head.rev,
        baseCourse: cloneCourse(head.course),
        remoteRev: head.rev,
        checkpoint: null,
        lastReport: null,
        lastError: null,
      };
      persist(get().course, get().savedRoutes, nextSession, readAnalysisState());
      set({ session: nextSession });
      return { status: 'published', rev: head.rev };
    },

    resolveConflict: (conflictId, side) => {
      const session = get().session;
      const conflict = session?.conflicts.find((item) => item.id === conflictId);
      if (!session || !conflict) return;
      const nextCourse = applyConflictResolution(get().course, conflict, side);
      const remaining = session.conflicts
        .filter((item) => item.id !== conflictId)
        .map((item) => (item.id === conflictId ? { ...item, chosen: side } : item));
      const chosenConflict: ConflictRecord = { ...conflict, chosen: side };
      const checkpoint = session.checkpoint
        ? {
            ...session.checkpoint,
            conflicts: session.checkpoint.conflicts.map((item) =>
              item.id === conflictId ? chosenConflict : item,
            ),
          }
        : null;
      adoptMergedCourse(nextCourse, {
        ...session,
        conflicts: remaining,
        checkpoint,
        lastError: null,
      });
    },

    retryMerge: () => {
      const session = get().session;
      if (!session?.checkpoint) return { status: 'failed', error: '没有可重试的合并。' };
      return mergeWithBoardHead(session, { useCheckpoint: true });
    },

    rollbackMerge: () => {
      const session = get().session;
      if (!session?.checkpoint) return;
      const checkpoint = session.checkpoint;
      const restored = cloneCourse(checkpoint.localCourse);
      const nextSession: CollabSession = {
        ...session,
        conflicts: checkpoint.conflicts,
        lastReport: null,
        lastError: null,
        // 检查点保留：随时可以重新合并；已并入的部分不会被删除
        checkpoint,
      };
      adoptMergedCourse(restored, nextSession);
    },

    dismissReport: () => {
      const session = get().session;
      if (session) saveSession({ ...session, lastReport: null });
    },

    updatePeerName: (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      persistPeerName(trimmed);
      const session = get().session;
      if (session) saveSession({ ...session, peerName: trimmed });
    },

    leaveCollab: () => clearSession(),
  };
});

function createBoardId() {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
