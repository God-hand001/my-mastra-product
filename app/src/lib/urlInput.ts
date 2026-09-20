// 地址栏输入解析:把用户输入判别为直接访问的网址、搜索引擎关键词,或拒绝伪协议

/**
 * 解析结果
 * - url:      可直接访问的 http/https 地址
 * - search:   需要交给搜索引擎的关键词
 * - rejected: 协议不在白名单,附带中文理由
 */
export type UrlResolution =
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string }
  | { kind: 'rejected'; reason: string };

/** 搜索地址模板,关键词用 encodeURIComponent 编码后拼接 */
export const SEARCH_ENGINE_TEMPLATE = 'https://www.bing.com/search?q=';

/** 含点、无空格、点后至少 2 个字母的域名形态(如 mastra.ai、example.com/path) */
const DOMAIN_LIKE = /^(?!.*\s).*\.[a-zA-Z]{2,}/;

/** 不含 // 的伪协议前缀(如 javascript:、data:、file:、自定义协议),一律拒绝 */
const PSEUDO_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * 判定用户输入应访问网址、搜索,还是拒绝。
 * 顺序:去空白 → 含 :// 则 URL 解析并校验 http/https → 无 // 的伪协议 → 域名形态补 https:// → 其余搜索。
 */
export function resolveUrlInput(raw: string): UrlResolution {
  const input = raw.trim();

  // 空输入直接拒绝,避免把空白当成关键词
  if (input === '') {
    return { kind: 'rejected', reason: '请输入网址或关键词' };
  }

  // 含 :// 时按完整 URL 解析,只允许 http: / https:
  if (input.includes('://')) {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return { kind: 'url', url: input };
      }
      return { kind: 'rejected', reason: '只支持 http 与 https 协议' };
    } catch {
      return { kind: 'rejected', reason: '网址格式不正确' };
    }
  }

  // 不含 :// 但形如 javascript:alert(1)、data:text/html 等伪协议,必须单独拦截
  // 否则会被当成关键词送往搜索引擎,造成安全隐患(AC9)
  if (PSEUDO_PROTOCOL.test(input)) {
    return { kind: 'rejected', reason: '只支持 http 与 https 协议' };
  }

  // 域名形态补全 https:// 后作为网址访问
  if (DOMAIN_LIKE.test(input)) {
    return { kind: 'url', url: `https://${input}` };
  }

  // 其余内容视为关键词,拼接搜索引擎地址
  return { kind: 'search', url: `${SEARCH_ENGINE_TEMPLATE}${encodeURIComponent(input)}` };
}
