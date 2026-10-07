import type {
  BoardRevision,
  ConflictRecord,
  ConflictSide,
  Course,
  Obstacle,
  SharedBoard,
  SharePayload,
} from '../types/course';
import { createId } from './course';
import { diff3Merge } from './diff3';

/* ------------------------------ 本地共享盘 ------------------------------ */
/* 纯前端项目，用同源 localStorage 扮演共享服务器：
   两位教练的浏览器/标签页写同一块盘，发布走 CAS（compare-and-swap），
   期望版本对不上就整份拒绝，保证同时保存只有一份成立。 */

export const BOARDS_KEY = 'strideplan:shared-boards';
export const SESSION_KEY = 'strideplan:collab-session';
export const PEER_KEY = 'strideplan:peer';
export const MAX_REVISIONS = 30;

export function readBoards(): Record<string, SharedBoard> {
  try {
    const raw = localStorage.getItem(BOARDS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SharedBoard>) : {};
  } catch {
    return {};
  }
}

function writeBoards(boards: Record<string, SharedBoard>) {
  localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
}

export function readBoard(docId: string): SharedBoard | null {
  return readBoards()[docId] ?? null;
}

export function createBoard(docId: string, docName: string, revision: BoardRevision): SharedBoard {
  const boards = readBoards();
  const board: SharedBoard = { docId, docName, createdAt: Date.now(), revisions: [revision] };
  boards[docId] = board;
  writeBoards(boards);
  return board;
}

export type CasResult =
  | { ok: true; board: SharedBoard }
  | { ok: false; reason: 'missing' | 'conflict'; currentRev: number };

/** 以期望版本号为条件追加修订；不匹配则整份拒绝，不写任何数据。 */
export function appendRevisionCas(
  docId: string,
  expectedRev: number,
  revision: Omit<BoardRevision, 'rev'>,
): CasResult {
  const boards = readBoards();
  const board = boards[docId];
  if (!board) return { ok: false, reason: 'missing', currentRev: -1 };
  const head = board.revisions[board.revisions.length - 1];
  if (head.rev !== expectedRev) {
    return { ok: false, reason: 'conflict', currentRev: head.rev };
  }
  const next: BoardRevision = { ...revision, rev: head.rev + 1 };
  board.revisions = [...board.revisions.slice(-(MAX_REVISIONS - 1)), next];
  writeBoards(boards);
  return { ok: true, board };
}

/* ------------------------------ 教练身份 ------------------------------ */

export interface Peer {
  id: string;
  name: string;
}

export function getPeer(): Peer {
  try {
    const raw = localStorage.getItem(PEER_KEY);
    if (raw) return JSON.parse(raw) as Peer;
  } catch {
    // fall through
  }
  const peer: Peer = { id: createId('peer'), name: `教练${Math.floor(Math.random() * 90 + 10)}` };
  localStorage.setItem(PEER_KEY, JSON.stringify(peer));
  return peer;
}

export function setPeerName(name: string) {
  const peer = getPeer();
  localStorage.setItem(PEER_KEY, JSON.stringify({ ...peer, name }));
}

/* ------------------------------ 分享链接 ------------------------------ */

function encodeJson(value: unknown): string {
  const bytes = new TextEncoder().encode(
    typeof value === 'string' ? value : JSON.stringify(value),
  );
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeJson<T>(token: string): T | null {
  try {
    const padded = token.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export function buildShareUrl(payload: SharePayload): string {
  const token = encodeJson(payload);
  return `${window.location.origin}${window.location.pathname}#collab=${token}`;
}

export function parseShareHash(hash: string): SharePayload | null {
  const match = hash.match(/collab=([^&]+)/)?.[1];
  if (!match) return null;
  const payload = decodeJson<SharePayload>(decodeURIComponent(match));
  if (!payload || payload.v !== 2 || !payload.docId || !payload.course) return null;
  return payload;
}

/* ------------------------------ 路径与标签 ------------------------------ */

export interface ScalarSpec {
  path: string;
  label: string;
}

/** 会让步数表 / 稳定度失效重算的参数（场地尺寸与马匹步幅族）。 */
export const STALE_PATHS = new Set([
  'arena.width',
  'arena.length',
  'horse.stepLength',
  'horse.approach',
  'horse.landing',
]);

export const SCALAR_SPECS: ScalarSpec[] = [
  { path: 'name', label: '路线名称' },
  { path: 'arena.width', label: '场地宽度' },
  { path: 'arena.length', label: '场地长度' },
  { path: 'arena.surface', label: '场地类型' },
  { path: 'horse.name', label: '马匹档案' },
  { path: 'horse.stepLength', label: '马匹步幅' },
  { path: 'horse.approach', label: '接近段' },
  { path: 'horse.landing', label: '落地段' },
  { path: 'gridSize', label: '栅格尺寸' },
];

export const OBSTACLE_FIELD_LABELS: Record<string, string> = {
  kind: '类型',
  name: '名称',
  x: '横向位置',
  y: '纵向位置',
  rotation: '朝向',
  width: '宽度',
  spread: '纵深',
  color: '颜色',
  difficulty: '难度',
  height: '高度',
};

export const OBSTACLE_FIELDS = Object.keys(OBSTACLE_FIELD_LABELS);

export function getPath(course: Course, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, course);
}

export function setPath(course: Course, path: string, value: unknown): Course {
  if (!path.includes('.')) return { ...course, [path]: value };
  const [head, ...rest] = path.split('.');
  const child = { ...(course[head as 'arena' | 'horse'] as unknown as Record<string, unknown>) };
  let target = child;
  rest.forEach((key, index) => {
    if (index === rest.length - 1) {
      target[key] = value;
    } else {
      target[key] = { ...(target[key] as Record<string, unknown>) };
      target = target[key] as Record<string, unknown>;
    }
  });
  return { ...course, [head]: child as unknown as Course['arena'] };
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '（已删除）';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

/* ------------------------------ 三方合并 ------------------------------ */

function sameObstacle(a?: Obstacle, b?: Obstacle): boolean {
  if (!a || !b) return a === b;
  return OBSTACLE_FIELDS.every((field) => a[field as keyof Obstacle] === b[field as keyof Obstacle]);
}

function sequenceText(course: Course): string {
  const pos = new Map(course.sequence.map((id, index) => [id, index + 1]));
  return course.obstacles
    .map((obstacle) => (pos.has(obstacle.id) ? `#${pos.get(obstacle.id)}` : '—'))
    .join(' ');
}

function reconcileSequence(sequence: string[], obstacles: Obstacle[]): string[] {
  const seen = new Set<string>();
  const kept = sequence.filter((id) => {
    if (seen.has(id) || !obstacles.some((item) => item.id === id)) return false;
    seen.add(id);
    return true;
  });
  obstacles.forEach((obstacle) => {
    if (!seen.has(obstacle.id)) kept.push(obstacle.id);
  });
  return kept;
}

/**
 * 三方合并。base 为共同基线（可能为 null：跨设备链接合并拿不到基线，
 * 此时退化为两路保守合并——不同即冲突，绝不静默覆盖）。
 */
export function mergeCourses(
  baseCourse: Course | null,
  localCourse: Course,
  remoteCourse: Course,
): { course: Course; conflicts: ConflictRecord[]; mergedLabels: string[] } {
  const conflicts: ConflictRecord[] = [];
  const mergedLabels: string[] = [];
  let merged: Course = structuredClone(localCourse);

  const getScalar = (course: Course | null, path: string) =>
    course ? getPath(course, path) : undefined;

  /* 1. 标量参数（场地、马匹、路线名等逐字段三方） */
  SCALAR_SPECS.forEach(({ path, label }) => {
    const b = getScalar(baseCourse, path);
    const l = getScalar(localCourse, path);
    const r = getScalar(remoteCourse, path);
    if (l === r) {
      merged = setPath(merged, path, l);
      return;
    }
    if (baseCourse && l === b) {
      merged = setPath(merged, path, r);
      mergedLabels.push(label);
      return;
    }
    if (baseCourse && r === b) {
      merged = setPath(merged, path, l);
      return;
    }
    conflicts.push({
      id: `conflict:${path}`,
      kind: 'scalar',
      scope: path,
      title: `${label}两边都改过`,
      detail: `本地 ${formatValue(l)}，对方 ${formatValue(r)}`,
      baseValue: b,
      localValue: l,
      remoteValue: r,
    });
  });

  /* 2. 障碍逐个、逐字段合并 */
  const baseMap = new Map(baseCourse?.obstacles.map((item) => [item.id, item]) ?? []);
  const localMap = new Map(localCourse.obstacles.map((item) => [item.id, item]));
  const remoteMap = new Map(remoteCourse.obstacles.map((item) => [item.id, item]));

  const allIds: string[] = [];
  const seen = new Set<string>();
  const pushId = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      allIds.push(id);
    }
  };
  baseCourse?.obstacles.forEach((item) => pushId(item.id));
  localCourse.obstacles.forEach((item) => pushId(item.id));
  remoteCourse.obstacles.forEach((item) => pushId(item.id));

  const mergedObstacles: Obstacle[] = [];

  allIds.forEach((id) => {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);

    if (l && r) {
      // 两边都保留：逐字段合并
      const next: Obstacle = { ...l };
      const differingFields: NonNullable<ConflictRecord['fields']> = [];
      let remoteApplied = false;
      OBSTACLE_FIELDS.forEach((field) => {
        const key = field as keyof Obstacle;
        const bv = b?.[key];
        const lv = l[key];
        const rv = r[key];
        if (lv === rv) {
          next[key] = lv as never;
        } else if (b && lv === bv) {
          next[key] = rv as never;
          remoteApplied = true;
        } else if (b && rv === bv) {
          next[key] = lv as never;
        } else {
          differingFields.push({
            key,
            label: OBSTACLE_FIELD_LABELS[field],
            base: bv,
            local: lv,
            remote: rv,
          });
        }
      });
      if (differingFields.length > 0) {
        conflicts.push({
          id: `conflict:obstacle:${id}`,
          kind: 'obstacle-field',
          scope: id,
          title: `${l.name} 的 ${differingFields.map((f) => f.label).join('、')}两边都调过`,
          detail: differingFields
            .map((field) => `${field.label}：本地 ${formatValue(field.local)} / 对方 ${formatValue(field.remote)}`)
            .join('；'),
          baseValue: b ?? null,
          localValue: l,
          remoteValue: r,
          fields: differingFields,
        });
      } else if (remoteApplied) {
        mergedLabels.push(`${l.name}（并入对方调整）`);
      }
      mergedObstacles.push(next);
      return;
    }

    if (l && !r) {
      if (b && sameObstacle(l, b)) {
        // 本地没动、对方删除：静默并入删除
        mergedLabels.push(`删除 ${b.name}`);
        return;
      }
      if (b) {
        // 一方在改、一方删除：两版都留
        conflicts.push({
          id: `conflict:obstacle:${id}`,
          kind: 'obstacle-delete',
          scope: id,
          title: `${l.name}：一方调整、一方删除`,
          detail: `本地保留并调整了该障碍，对方把它删除了。`,
          baseValue: b,
          localValue: l,
          remoteValue: null,
        });
      }
      // 本地新增（基线里没有），直接保留
      mergedObstacles.push(l);
      return;
    }

    if (!l && r) {
      if (b && sameObstacle(r, b)) {
        // 对方没动、本地删除：静默并入删除
        mergedLabels.push(`删除 ${b.name}`);
        return;
      }
      if (b) {
        conflicts.push({
          id: `conflict:obstacle:${id}`,
          kind: 'obstacle-delete',
          scope: id,
          title: `${r.name}：一方删除、一方调整`,
          detail: `本地删除了该障碍，对方保留并调整了它。`,
          baseValue: b,
          localValue: null,
          remoteValue: r,
        });
        return;
      }
      // 对方新增：直接并入
      mergedObstacles.push(r);
      mergedLabels.push(`新增 ${r.name}`);
      return;
    }

    // 两边都删了
  });

  merged = { ...merged, obstacles: mergedObstacles };

  /* 3. 跳次顺序：diff3 三方对齐 */
  const seqBase = baseCourse?.sequence ?? [];
  const seqDiff = diff3Merge(seqBase, localCourse.sequence, remoteCourse.sequence);
  let sequence = reconcileSequence(seqDiff.merged, mergedObstacles);
  const sequenceTouched =
    JSON.stringify(localCourse.sequence) !== JSON.stringify(seqBase) ||
    JSON.stringify(remoteCourse.sequence) !== JSON.stringify(seqBase);
  if (seqDiff.conflicts.length > 0) {
    conflicts.push({
      id: 'conflict:sequence',
      kind: 'sequence',
      scope: 'sequence',
      title: '跳次顺序两边都调整过',
      detail: `本地顺序 ${sequenceText(localCourse)}；对方顺序 ${sequenceText(remoteCourse)}`,
      baseValue: seqBase,
      localValue: localCourse.sequence,
      remoteValue: remoteCourse.sequence,
    });
  } else if (sequenceTouched && baseCourse) {
    mergedLabels.push('跳次顺序');
  }
  merged = { ...merged, sequence };

  merged.updatedAt = Math.max(localCourse.updatedAt, remoteCourse.updatedAt);
  return { course: merged, conflicts, mergedLabels };
}

/** 对一个冲突做出裁决，返回新的路线。 */
export function applyConflictResolution(
  course: Course,
  conflict: ConflictRecord,
  side: ConflictSide,
): Course {
  const value = side === 'local' ? conflict.localValue : conflict.remoteValue;
  if (conflict.kind === 'scalar') {
    return setPath(course, conflict.scope, value);
  }
  if (conflict.kind === 'sequence') {
    return { ...course, sequence: reconcileSequence((value as string[]) ?? [], course.obstacles) };
  }
  if (conflict.kind === 'obstacle-delete') {
    const remaining = course.obstacles.filter((item) => item.id !== conflict.scope);
    if (value) {
      const originalIndex = course.obstacles.findIndex((item) => item.id === conflict.scope);
      const insertAt = originalIndex >= 0 ? Math.min(originalIndex, remaining.length) : remaining.length;
      remaining.splice(insertAt, 0, value as Obstacle);
    }
    return {
      ...course,
      obstacles: remaining,
      sequence: reconcileSequence(course.sequence, remaining),
    };
  }
  // obstacle-field：逐字段采用选中侧
  const obstacles = course.obstacles.map((obstacle) => {
    if (obstacle.id !== conflict.scope) return obstacle;
    const next = { ...obstacle };
    const source = (side === 'local' ? conflict.localValue : conflict.remoteValue) as Obstacle;
    conflict.fields?.forEach((field) => {
      (next as Record<string, unknown>)[field.key] = source[field.key as keyof Obstacle];
    });
    return next;
  });
  return { ...course, obstacles };
}

/** 冲突障碍是否带位置类分歧（用于在画布上画出对方那版的虚影）。 */
export function conflictGhostPosition(conflict: ConflictRecord): { x: number; y: number } | null {
  if (conflict.kind !== 'obstacle-field' || !conflict.fields) return null;
  const hasPosition = conflict.fields.some((field) => field.key === 'x' || field.key === 'y');
  if (!hasPosition) return null;
  const remote = conflict.remoteValue as Obstacle | null;
  if (!remote) return null;
  return { x: remote.x, y: remote.y };
}

/* --------------------------- 步数表/稳定度失效 --------------------------- */

export function analysisSignature(course: Course): string {
  return JSON.stringify({
    aw: course.arena.width,
    al: course.arena.length,
    hs: course.horse.stepLength,
    ha: course.horse.approach,
    hl: course.horse.landing,
  });
}
