export interface UpdatePackage {
  arch: string
  format: string
  installer: string
  filename: string
  url: string
  sha256: string
}

export interface UpdateLog {
  version: string
  date: string
  title: string
  content: string[]
  // 英文发布说明；历史数据可能缺失，渲染层会明确标注「仅提供中文」。
  titleEn?: string
  contentEn?: string[]
}

export interface UpdateLogsResult {
  success: boolean
  releases?: UpdateLog[]
  error?: string
}

export interface UpdateInfo {
  title: string
  version: string
  date: string
  channel: string
  content: string[]
  titleEn?: string
  contentEn?: string[]
  download: UpdatePackage
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  update: UpdateInfo | null
}

export interface UpdateDownloadProgress {
  percent: number
  receivedBytes: number
  totalBytes: number
}

export interface UpdateDownloadResult {
  status: 'downloaded' | 'external'
  filePath?: string
}
