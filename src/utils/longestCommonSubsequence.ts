/**
 * 最长公共子序列（LCS）工具。
 *
 * 行级 diff 与源码保真序列化都需要「按行求公共子序列」这一步，
 * 之前两处各写了一份相同的动态规划实现，这里收敛成唯一来源。
 */

/**
 * 计算两个数组的公共子序列匹配下标对。
 *
 * 使用后缀式动态规划：lengths[i][j] 表示 a[i..] 与 b[j..] 的最长公共子序列长度。
 * 由于 a、b 已经是数组，这里用数组下标作为等价判断依据，
 * 调用方若需要按内容比较，先把内容数组传进来即可。
 *
 * @param a 旧序列
 * @param b 新序列
 * @returns 匹配下标对数组，形如 [[0, 0], [2, 1]]，按遍历顺序排列
 */
export const lcsMatches = (
  a: readonly string[],
  b: readonly string[],
): Array<[number, number]> => {
  const rows = a.length;
  const cols = b.length;
  // 任一序列为空时不存在公共子序列，直接返回，省掉建表开销。
  if (rows === 0 || cols === 0) return [];

  // 后缀式动态规划表，多一行一列作为哨兵，省去边界判断。
  const lengths: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  // 从左上角回溯：相等即配对，否则走向 LCS 更长的一侧。
  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      matches.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
};
