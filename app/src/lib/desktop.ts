// 桌面壳环境检测(H0:项目功能仅桌面端提供)
export interface JlcDesktopBridge {
  selectDirectory: () => Promise<string | null>;
  openPath: (dir: string) => Promise<string>;
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!(window as { jlcDesktop?: unknown }).jlcDesktop;
}

export function desktopBridge(): JlcDesktopBridge | null {
  return isDesktop() ? ((window as unknown as { jlcDesktop?: JlcDesktopBridge }).jlcDesktop ?? null) : null;
}
