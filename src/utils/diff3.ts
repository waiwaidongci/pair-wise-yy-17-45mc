/**
 * 经典 diff / diff3 合并，作用在可比较的 token 数组上（本项目用障碍 id 序列）。
 * 先对 base↔local、base↔remote 分别求 LCS diff，再按经典 diff3 规则合并：
 *  - 只有一边改到的区块直接并入；
 *  - 两边改动覆盖同一 base 区间时产出冲突，两版都保留给调用方裁决。
 */

export type Token = string;

interface Region {
  /** base 上的半开区间；纯插入时 baseStart === baseEnd */
  baseStart: number;
  baseEnd: number;
  /** 该区间在新版本中对应的半开区间 */
  bStart: number;
  bEnd: number;
  /** true 表示与 base 不同（删除/插入/替换） */
  changed: boolean;
}

/** 生成覆盖整条序列的对齐区域（稳定段 + 改动 hunk）。 */
export function alignRegions(a: Token[], b: Token[]): Region[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // 沿 LCS 表回溯，收集改动（删除/插入）的连续区段
  const hunks: Array<{ aStart: number; aEnd: number; bStart: number; bEnd: number }> = [];
  let i = 0;
  let j = 0;
  let current: (typeof hunks)[number] | null = null;
  const flush = () => {
    if (current) hunks.push(current);
    current = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (i < n && (j === m || lcs[i + 1][j] > lcs[i][j + 1])) {
      // a[i] 被删除
      if (!current) current = { aStart: i, aEnd: i, bStart: j, bEnd: j };
      current.aEnd = i + 1;
      i += 1;
    } else if (j < m) {
      // b[j] 是新增
      if (!current) current = { aStart: i, aEnd: i, bStart: j, bEnd: j };
      current.bEnd = j + 1;
      j += 1;
    } else {
      break;
    }
  }
  flush();

  const regions: Region[] = [];
  let baseCursor = 0;
  let bCursor = 0;
  hunks.forEach((hunk) => {
    if (hunk.aStart > baseCursor) {
      const length = hunk.aStart - baseCursor;
      regions.push({
        baseStart: baseCursor,
        baseEnd: hunk.aStart,
        bStart: bCursor,
        bEnd: bCursor + length,
        changed: false,
      });
      bCursor += length;
    }
    regions.push({
      baseStart: hunk.aStart,
      baseEnd: hunk.aEnd,
      bStart: hunk.bStart,
      bEnd: hunk.bEnd,
      changed: true,
    });
    baseCursor = hunk.aEnd;
    bCursor = hunk.bEnd;
  });
  if (baseCursor < n) {
    regions.push({
      baseStart: baseCursor,
      baseEnd: n,
      bStart: bCursor,
      bEnd: bCursor + (n - baseCursor),
      changed: false,
    });
  }
  return regions;
}

/** base 边界 p 映射到新版本数组的下标（p 落在改动区内时夹到该 hunk 起点）。 */
function toBIndex(regions: Region[], p: number): number {
  let baseCursor = 0;
  let bCursor = 0;
  for (const region of regions) {
    if (p <= region.baseStart) return bCursor + (p - baseCursor);
    if (p < region.baseEnd) return region.bStart;
    baseCursor = region.baseEnd;
    bCursor = region.bEnd;
  }
  return bCursor + (p - baseCursor);
}

export interface Diff3Result {
  merged: Token[];
  /** 每个冲突包含双方各自的完整区块；为空代表可全自动合并 */
  conflicts: Array<{ local: Token[]; remote: Token[] }>;
}

export function diff3Merge(base: Token[], local: Token[], remote: Token[]): Diff3Result {
  // 只保留改动 hunk，稳定内容在循环里直接从 base 取
  const localHunks = alignRegions(base, local).filter((region) => region.changed);
  const remoteHunks = alignRegions(base, remote).filter((region) => region.changed);
  const merged: Token[] = [];
  const conflicts: Diff3Result['conflicts'] = [];

  let li = 0;
  let ri = 0;
  let baseCursor = 0;

  for (;;) {
    const L = li < localHunks.length ? localHunks[li] : null;
    const R = ri < remoteHunks.length ? remoteHunks[ri] : null;
    if (!L && !R) {
      for (let k = baseCursor; k < base.length; k += 1) merged.push(base[k]);
      break;
    }

    const localStart = L ? L.baseStart : base.length;
    const remoteStart = R ? R.baseStart : base.length;
    const stableEnd = Math.min(localStart, remoteStart);
    if (stableEnd > baseCursor) {
      for (let k = baseCursor; k < stableEnd; k += 1) merged.push(base[k]);
      baseCursor = stableEnd;
    }

    // 两个 hunk 是否需要作为冲突一起处理：
    //  1) base 区间交叠；
    //  2) 两边都是纯插入且在同一个中间插入点各插各的；
    //  3) 一边纯插入的点落在另一边删除/替换区间内。
    const touches = (
      hunk: { baseStart: number; baseEnd: number },
      other: { baseStart: number; baseEnd: number },
    ) => {
      const pointInsert = hunk.baseStart === hunk.baseEnd;
      const otherInsert = other.baseStart === other.baseEnd;
      if (pointInsert && otherInsert) {
        // 同一中间插入点各插各的才算冲突；首尾追加自动并入
        return hunk.baseStart === other.baseStart && hunk.baseStart > 0 && hunk.baseStart < base.length;
      }
      if (pointInsert) {
        // 插入点落在删除/替换区间 [start, end] 内（含边界）即冲突
        return hunk.baseStart >= other.baseStart && hunk.baseStart <= other.baseEnd && hunk.baseStart < base.length;
      }
      if (otherInsert) {
        return other.baseStart >= hunk.baseStart && other.baseStart <= hunk.baseEnd && other.baseStart < base.length;
      }
      // 区间交叠
      return hunk.baseStart < other.baseEnd && hunk.baseEnd > other.baseStart;
    };

    if (L && (!R || !touches(L, R))) {
      // 仅本地改动
      local.slice(L.bStart, L.bEnd).forEach((token) => merged.push(token));
      baseCursor = L.baseEnd;
      li += 1;
      continue;
    }
    if (R && (!L || !touches(R, L))) {
      // 仅远端改动
      remote.slice(R.bStart, R.bEnd).forEach((token) => merged.push(token));
      baseCursor = R.baseEnd;
      ri += 1;
      continue;
    }

    // 双方改动落在同一 base 区域：把所有相连的 hunk 归为一个冲突组
    const localFirst = li;
    const remoteFirst = ri;
    // 冲突组的右沿用“覆盖到的最后一个 base 位置”，纯插入视作占用插入点与下一个位置之间，
    // 因此相邻的删除/替换 hunk（如一次交换产生的 插入+删除）也在同组。
    const reachEnd = (hunk: Region) => (hunk.baseStart === hunk.baseEnd ? hunk.baseEnd + 1 : hunk.baseEnd);
    let groupEnd = Math.max(reachEnd(L!), reachEnd(R!));
    li += 1;
    ri += 1;
    let grew = true;
    while (grew) {
      grew = false;
      while (li < localHunks.length && localHunks[li].baseStart <= groupEnd) {
        groupEnd = Math.max(groupEnd, reachEnd(localHunks[li]));
        li += 1;
        grew = true;
      }
      while (ri < remoteHunks.length && remoteHunks[ri].baseStart <= groupEnd) {
        groupEnd = Math.max(groupEnd, reachEnd(remoteHunks[ri]));
        ri += 1;
        grew = true;
      }
    }
    // 组右沿：最后一个被纳入的删除/替换 hunk 的 baseEnd；
    // 若组里只有纯插入（baseStart===baseEnd），则游标停在插入点不动。
    const consumedLocalEnd = li > localFirst ? localHunks[li - 1].baseEnd : L!.baseEnd;
    const consumedRemoteEnd = ri > remoteFirst ? remoteHunks[ri - 1].baseEnd : R!.baseEnd;
    const localHasDelete = li > localFirst && localHunks.slice(localFirst, li).some((h) => h.baseEnd > h.baseStart);
    const remoteHasDelete = ri > remoteFirst && remoteHunks.slice(remoteFirst, ri).some((h) => h.baseEnd > h.baseStart);
    const actualGroupEnd =
      localHasDelete || remoteHasDelete
        ? Math.max(localHasDelete ? consumedLocalEnd : 0, remoteHasDelete ? consumedRemoteEnd : 0)
        : L!.baseStart;

    // 双方片段按该组内实际消费的 hunk 跨度截取（含同一插入点两侧的内容）
    const localBlock =
      li > localFirst
        ? local.slice(localHunks[localFirst].bStart, localHunks[li - 1].bEnd)
        : [];
    const remoteBlock =
      ri > remoteFirst
        ? remote.slice(remoteHunks[remoteFirst].bStart, remoteHunks[ri - 1].bEnd)
        : [];
    conflicts.push({ local: localBlock, remote: remoteBlock });
    // 合并稿先挂本地版，裁决时可整体换成远端版
    localBlock.forEach((token) => merged.push(token));
    // 纯插入 hunk 的 baseEnd 停在插入点，组右沿可能跨过双方都保留的稳定 token，
    // 按 base 顺序把双方版本里都仍存在的尾巴补回，避免丢内容
    for (let k = baseCursor; k < actualGroupEnd; k += 1) {
      const token = base[k];
      if (local.includes(token) && remote.includes(token) && !localBlock.includes(token)) {
        merged.push(token);
      }
    }
    baseCursor = actualGroupEnd;
  }

  return { merged, conflicts };
}
