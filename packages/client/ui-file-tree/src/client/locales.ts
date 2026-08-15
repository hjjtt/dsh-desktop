/** fileTree namespace dictionaries (zh is the product copy; en mirrors it). */

export const zh = {
  'section.aria': '工作区文件树',
  'level.loading': '加载中…',
  'level.error': '加载失败',
  'level.retry': '重试',
  'level.truncated': '条目过多，已截断',
  'level.empty': '空目录',
  'row.expand': '展开 {name}',
} as const

export type FileTreeKey = keyof typeof zh

export const en: Readonly<Record<FileTreeKey, string>> = {
  'section.aria': 'Workspace file tree',
  'level.loading': 'Loading…',
  'level.error': 'Failed to load',
  'level.retry': 'Retry',
  'level.truncated': 'Too many entries, truncated',
  'level.empty': 'Empty directory',
  'row.expand': 'Expand {name}',
}
