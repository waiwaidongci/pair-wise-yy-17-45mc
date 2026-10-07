export type ObstacleKind =
  | 'vertical'
  | 'oxer'
  | 'triple'
  | 'wall'
  | 'water'
  | 'combination';

export type Difficulty = '入门' | '进阶' | '挑战';

export interface Arena {
  width: number;
  length: number;
  surface: string;
}

export interface HorseProfile {
  name: string;
  stepLength: number;
  approach: number;
  landing: number;
}

export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  name: string;
  x: number;
  y: number;
  rotation: number;
  width: number;
  spread: number;
  color: string;
  difficulty: Difficulty;
  height: number;
}

export interface Course {
  id: string;
  name: string;
  arena: Arena;
  horse: HorseProfile;
  obstacles: Obstacle[];
  sequence: string[];
  gridSize: number;
  updatedAt: number;
}

export type IssueLevel = 'ok' | 'warning' | 'error';

export interface RouteIssue {
  id: string;
  level: IssueLevel;
  title: string;
  detail: string;
  obstacleIds: string[];
}

export interface StrideRow {
  fromId: string;
  toId: string;
  fromNumber: number;
  toNumber: number;
  distance: number;
  clearDistance: number;
  strides: number;
  recommended: number;
  deviation: number;
  turnAngle: number;
  level: IssueLevel;
}

export interface RouteAnalysis {
  rows: StrideRow[];
  issues: RouteIssue[];
  totalDistance: number;
  estimatedSeconds: number;
  score: number;
}

export interface RouteOption {
  id: string;
  name: string;
  difficulty: Difficulty;
  description: string;
  sequence: string[];
  score: number;
  estimatedSeconds: number;
}

export interface SavedRoute {
  id: string;
  name: string;
  savedAt: number;
  course: Course;
  score: number;
}

export interface ObstaclePreset {
  kind: ObstacleKind;
  name: string;
  width: number;
  spread: number;
  height: number;
  color: string;
}

/* ----------------------------- 协作与合并 ----------------------------- */

export type PeerId = string;

export interface BoardRevision {
  rev: number;
  authorId: PeerId;
  authorName: string;
  at: number;
  course: Course;
}

export interface SharedBoard {
  docId: string;
  docName: string;
  createdAt: number;
  revisions: BoardRevision[];
}

export type ConflictKind = 'scalar' | 'obstacle-field' | 'obstacle-delete' | 'sequence';
export type ConflictSide = 'local' | 'remote';

export interface ConflictField {
  key: string;
  label: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export interface ConflictRecord {
  id: string;
  kind: ConflictKind;
  /** 标量路径（arena.width）、障碍 id 或 sequence */
  scope: string;
  title: string;
  detail: string;
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
  fields?: ConflictField[];
  chosen?: ConflictSide;
}

export interface MergeReport {
  at: number;
  /** 自动并入的条目描述，如「3号 双横木」「场地宽度」 */
  mergedLabels: string[];
  conflictCount: number;
  note: string;
}

export interface MergeCheckpoint {
  at: number;
  /** 合并前的本地版本（回退目标） */
  localCourse: Course;
  /** 合并时使用的远端版本与基线 */
  remoteCourse: Course;
  baseCourse: Course | null;
  prevBaseRev: number;
  remoteRev: number;
  conflicts: ConflictRecord[];
  report: MergeReport;
}

export interface CollabSession {
  docId: string;
  peerId: PeerId;
  peerName: string;
  online: boolean;
  /** 本地基线所在的共享盘版本 */
  baseRev: number;
  baseCourse: Course | null;
  /** 已知共享盘最新版本号 */
  remoteRev: number;
  /** 本浏览器是否能访问到共享盘（跨设备仅能靠链接合并） */
  remoteAvailable: boolean;
  conflicts: ConflictRecord[];
  checkpoint: MergeCheckpoint | null;
  lastReport: MergeReport | null;
  lastError: string | null;
}

export interface MergeOutput {
  course: Course;
  conflicts: ConflictRecord[];
  mergedLabels: string[];
}

export interface SharePayload {
  v: 2;
  docId: string;
  rev: number;
  from: string;
  course: Course;
}

