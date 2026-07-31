export interface UpdatePackage {
  arch: string
  format: string
  installer: string
  filename: string
  url: string
}

export interface UpdateLog {
  version: string
  date: string
  title: string
  content: string[]
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
