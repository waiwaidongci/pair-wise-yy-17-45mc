import type { Course, Obstacle } from '../types/course';
import { createId } from './course';

/**
 * 协作信封：分享链接里携带的不再只是一份路线，而是某个协作会话的一个版本。
 * 两位教练各自保存时 revision 单调递增，basedOn 记录该版本基于哪一版，
 * 合并时以此判断「并发保存」与「快速跟进」。
 */
export interface CollaborationEnvelope {
  kind: 'strideplan-collab-1';
  sessionId: string;
  revision: number;
  basedOn: number;
  author: string;
  savedAt: number;
  course: Course;
}

export type CollabConflictKind = 'obstacle' | 'order' | 'arena' | 'horse';

export interface ObstacleConflict {
  id: string;
  kind: 'obstacle';
  obstacleId: string;
  shadowId: string | null;
  base: Obstacle | null;
  ours: Obstacle | null;
  theirs: Obstacle | null;
}

export interface OrderConflict {
  id: string;
  kind: 'order';
  base: string[];
  ours: string[];
  theirs: string[];
}

export interface ParamConflict {
  id: string;
  kind: 'arena' | 'horse';
  ours: Course['arena'] | Course['horse'];
  theirs: Course['arena'] | Course['horse'];
}

export type CollabConflict = ObstacleConflict | OrderConflict | ParamConflict;

export interface MergeResult {
  course: Course;
  conflicts: CollabConflict[];
}

export interface CollabDiff {
  obstacles: number;
  orderChanged: boolean;
  arenaChanged: boolean;
  horseChanged: boolean;
}

export function createSessionId() {
  return createId('session');
}

export function encodeEnvelope(envelope: CollaborationEnvelope): string {
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export type DecodedShare =
  | { kind: 'envelope'; envelope: CollaborationEnvelope }
  | { kind: 'legacy'; course: Course }
  | null;

export function decodeShareToken(token: string): DecodedShare {
  try {
    const binary = atob(token);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && parsed.kind === 'strideplan-collab-1' && parsed.course) {
      return { kind: 'envelope', envelope: parsed as CollaborationEnvelope };
    }
    if (parsed && Array.isArray(parsed.obstacles)) {
      return { kind: 'legacy', course: parsed as Course };
    }
    return null;
  } catch {
    return null;
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((item, index) => deepEqual(item, b[index]));
    }
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]));
  }
  return false;
}

function cloneObstacle(obstacle: Obstacle): Obstacle {
  return structuredClone(obstacle);
}

function sequenceEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 三路合并：base 是双方上次同步的基线，ours 是本机工作副本，theirs 是对方版本。
 * - 只有一方改动的障碍直接并入；
 * - 双方都改动同一道障碍：保留我方版本，同时追加一份对方版本（带 conflict 标记），
 *   由教练在冲突面板里决定采用哪一版；
 * - 跳次顺序、场地、马匹参数同理，双方都改时标冲突。
 */
export function mergeCourses(
  base: Course,
  ours: Course,
  theirs: Course,
  theirRevision: number,
): MergeResult {
  const baseMap = new Map(base.obstacles.map((item) => [item.id, item]));
  const oursMap = new Map(ours.obstacles.map((item) => [item.id, item]));
  const theirsMap = new Map(theirs.obstacles.map((item) => [item.id, item]));
  const allIds = new Set([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]);

  const mergedObstacles: Obstacle[] = [];
  const conflicts: CollabConflict[] = [];
  const shadowIds: string[] = [];

  allIds.forEach((id) => {
    const baseItem = baseMap.get(id);
    const oursItem = oursMap.get(id);
    const theirsItem = theirsMap.get(id);
    const inBase = Boolean(baseItem);
    const inOurs = Boolean(oursItem);
    const inTheirs = Boolean(theirsItem);

    const ourChanged = inOurs && (!inBase || !deepEqual(oursItem, baseItem));
    const theirChanged = inTheirs && (!inBase || !deepEqual(theirsItem, baseItem));

    if (!inOurs && !inTheirs) return;

    if (inOurs && !inTheirs) {
      if (!inBase) {
        // 我方新增、对方没有 → 保留我方新增
        mergedObstacles.push(cloneObstacle(oursItem!));
        return;
      }
      // 基线中存在、对方删除了：我方未动则接受删除，我方改过则冲突并保留我方版本
      if (!ourChanged) return;
      conflicts.push({
        id: createId('conflict'),
        kind: 'obstacle',
        obstacleId: id,
        shadowId: null,
        base: baseItem ? cloneObstacle(baseItem) : null,
        ours: oursItem ? cloneObstacle(oursItem) : null,
        theirs: null,
      });
      if (oursItem) mergedObstacles.push(cloneObstacle(oursItem));
      return;
    }

    if (!inOurs && inTheirs) {
      if (!inBase) {
        // 对方新增的障碍，直接加入
        mergedObstacles.push(cloneObstacle(theirsItem!));
        return;
      }
      // 基线中存在、我方删除了：对方未动则接受删除，对方改过则冲突并保留对方版本避免丢失
      if (!theirChanged) return;
      conflicts.push({
        id: createId('conflict'),
        kind: 'obstacle',
        obstacleId: id,
        shadowId: null,
        base: baseItem ? cloneObstacle(baseItem) : null,
        ours: null,
        theirs: theirsItem ? cloneObstacle(theirsItem) : null,
      });
      if (theirsItem) mergedObstacles.push(cloneObstacle(theirsItem));
      return;
    }

    if (!ourChanged && !theirChanged) {
      mergedObstacles.push(cloneObstacle((baseItem ?? oursItem)!));
      return;
    }
    if (ourChanged && !theirChanged) {
      mergedObstacles.push(cloneObstacle(oursItem!));
      return;
    }
    if (!ourChanged && theirChanged) {
      mergedObstacles.push(cloneObstacle(theirsItem!));
      return;
    }
    if (deepEqual(oursItem, theirsItem)) {
      mergedObstacles.push(cloneObstacle(oursItem!));
      return;
    }

    // 双方都改了同一道障碍：两版都留下，对方版作为影子副本追加在后面
    const shadowId = `${id}__conflict_${theirRevision}`;
    const shadow: Obstacle = {
      ...cloneObstacle(theirsItem!),
      id: shadowId,
      name: `${theirsItem!.name}（对方版）`,
    };
    mergedObstacles.push(cloneObstacle(oursItem!), shadow);
    shadowIds.push(shadowId);
    conflicts.push({
      id: createId('conflict'),
      kind: 'obstacle',
      obstacleId: id,
      shadowId,
      base: baseItem ? cloneObstacle(baseItem) : null,
      ours: cloneObstacle(oursItem!),
      theirs: cloneObstacle(theirsItem!),
    });
  });

  const mergedIds = new Set(mergedObstacles.map((item) => item.id));
  const baseOrder = base.sequence.filter((id) => mergedIds.has(id));
  const oursOrder = ours.sequence.filter((id) => mergedIds.has(id) && !shadowIds.includes(id));
  const theirsOrder = theirs.sequence.filter((id) => mergedIds.has(id) && !shadowIds.includes(id));

  // 只比较基线中已存在的障碍的相对顺序，新增障碍不影响「是否重排」的判断
  const commonIds = new Set(base.sequence);
  const orderOf = (seq: string[]) => seq.filter((id) => commonIds.has(id));
  const ourOrderChanged = !sequenceEqual(orderOf(oursOrder), orderOf(baseOrder));
  const theirOrderChanged = !sequenceEqual(orderOf(theirsOrder), orderOf(baseOrder));

  let orderConflict: OrderConflict | null = null;
  let preferredOrder: string[];
  if (!ourOrderChanged && !theirOrderChanged) {
    preferredOrder = baseOrder;
  } else if (!ourOrderChanged && theirOrderChanged) {
    preferredOrder = theirsOrder;
  } else if (ourOrderChanged && !theirOrderChanged) {
    preferredOrder = oursOrder;
  } else {
    preferredOrder = oursOrder;
    orderConflict = {
      id: createId('conflict'),
      kind: 'order',
      base: baseOrder,
      ours: oursOrder,
      theirs: theirsOrder,
    };
  }

  // 追加双方新增的障碍（保持各自相对顺序），影子副本排在最后
  const mergedSequence = [...preferredOrder];
  const appendMissing = (ids: string[]) => {
    ids.forEach((id) => {
      if (mergedIds.has(id) && !mergedSequence.includes(id)) mergedSequence.push(id);
    });
  };
  appendMissing(ours.sequence);
  appendMissing(theirs.sequence);
  shadowIds.forEach((id) => {
    if (!mergedSequence.includes(id)) mergedSequence.push(id);
  });

  let arena = deepEqual(ours.arena, base.arena) ? theirs.arena : ours.arena;
  let horse = deepEqual(ours.horse, base.horse) ? theirs.horse : ours.horse;
  if (!deepEqual(ours.arena, base.arena) && !deepEqual(theirs.arena, base.arena) && !deepEqual(ours.arena, theirs.arena)) {
    conflicts.push({
      id: createId('conflict'),
      kind: 'arena',
      ours: structuredClone(ours.arena),
      theirs: structuredClone(theirs.arena),
    });
    arena = ours.arena;
  }
  if (!deepEqual(ours.horse, base.horse) && !deepEqual(theirs.horse, base.horse) && !deepEqual(ours.horse, theirs.horse)) {
    conflicts.push({
      id: createId('conflict'),
      kind: 'horse',
      ours: structuredClone(ours.horse),
      theirs: structuredClone(theirs.horse),
    });
    horse = ours.horse;
  }
  if (orderConflict) conflicts.push(orderConflict);

  const merged: Course = {
    ...structuredClone(ours),
    name: ours.name !== base.name ? ours.name : theirs.name,
    obstacles: mergedObstacles,
    sequence: mergedSequence,
    arena: structuredClone(arena),
    horse: structuredClone(horse),
    gridSize: ours.gridSize !== base.gridSize ? ours.gridSize : theirs.gridSize,
    updatedAt: Math.max(ours.updatedAt, theirs.updatedAt),
  };

  return { course: merged, conflicts };
}

/** 描述对方版本相对基线改了什么，用于合并提示。 */
export function describeDiff(base: Course, course: Course): CollabDiff {
  const baseMap = new Map(base.obstacles.map((item) => [item.id, item]));
  const courseMap = new Map(course.obstacles.map((item) => [item.id, item]));
  const allIds = new Set([...baseMap.keys(), ...courseMap.keys()]);
  let obstacles = 0;
  allIds.forEach((id) => {
    const a = baseMap.get(id);
    const b = courseMap.get(id);
    if (!a || !b || !deepEqual(a, b)) obstacles += 1;
  });
  const commonIds = new Set(base.sequence);
  const orderOf = (seq: string[]) => seq.filter((id) => commonIds.has(id));
  const orderChanged = !sequenceEqual(orderOf(base.sequence), orderOf(course.sequence));
  return {
    obstacles,
    orderChanged,
    arenaChanged: !deepEqual(base.arena, course.arena),
    horseChanged: !deepEqual(base.horse, course.horse),
  };
}

export function diffSummary(diff: CollabDiff): string {
  const parts: string[] = [];
  if (diff.obstacles) parts.push(`${diff.obstacles} 处障碍调整`);
  if (diff.orderChanged) parts.push('跳次顺序调整');
  if (diff.arenaChanged) parts.push('场地尺寸调整');
  if (diff.horseChanged) parts.push('马匹参数调整');
  return parts.length ? parts.join('、') : '无差异';
}
