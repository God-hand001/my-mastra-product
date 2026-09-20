// Agent 产物标记的前端协议解析:只识别消息文本,不在消息里暴露本地路径
import { resolveUrlInput } from './urlInput';

export type Artifact = {
  name: string;
  path: string;
};

const ARTIFACT_PATTERN = /【产物:(.+?)#(.+?)】/g;

export function parseArtifacts(text: string): Artifact[] {
  return [...text.matchAll(ARTIFACT_PATTERN)].map(match => ({
    name: match[1].trim(),
    path: match[2].trim(),
  }));
}

export function stripArtifactMarkers(text: string): string {
  return text.replace(/[ \t]*【产物:(.+?)#(.+?)】[ \t]*(?:\r?\n)?/g, '');
}

export type WebPage = {
  title: string;
  url: string;
};

const WEBPAGE_PATTERN = /【网页:(.+?)#(.+?)】/g;

/**
 * 解析模型输出的网页标记。
 * 模型输出不可信任,必须对 URL 做与地址栏相同的协议白名单校验,
 * 仅保留 kind === 'url' 的合法 http/https 地址,其余直接丢弃。
 */
export function parseWebPages(text: string): WebPage[] {
  return [...text.matchAll(WEBPAGE_PATTERN)]
    .map(match => {
      const title = match[1].trim();
      const resolved = resolveUrlInput(match[2].trim());
      if (resolved.kind !== 'url') return null;
      return { title, url: resolved.url };
    })
    .filter((item): item is WebPage => item !== null);
}

export function stripWebPageMarkers(text: string): string {
  return text.replace(/[ \t]*【网页:(.+?)#(.+?)】[ \t]*(?:\r?\n)?/g, '');
}
