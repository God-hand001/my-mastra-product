// pptx 站内渲染公共逻辑:预览栏 PptxView 与产物卡内联预览 InlinePreview 共用。
//
// pptxgenjs 生成的 pptx 会在 [Content_Types].xml 里声明一批实际不存在的 slideMaster
// (真 Office 容忍这种幽灵声明;pptx-preview 按声明逐个加载,取不到文件时抛错被它
// 内部 try/catch 静默吞掉),表现为渲染出一片空白且不报错(2026-09-18 用户实测)。
// 因此渲染后必须校验确实产出了幻灯片;零张时剔除指向缺失文件的 Override 重试一次,
// 仍为零张才抛错 —— 调用方据此显示失败态,而不是无声留白。
import { init } from 'pptx-preview';

export type PptxPreviewer = ReturnType<typeof init>;

async function renderOnce(
  container: HTMLElement,
  buffer: ArrayBuffer,
  width: number,
  register: (p: PptxPreviewer) => void,
): Promise<number> {
  container.innerHTML = '';
  const previewer = init(container, { width, mode: 'list' });
  register(previewer);
  await previewer.preview(buffer);
  return container.querySelectorAll('.pptx-preview-slide-wrapper').length;
}

export async function renderPptxWithSanitize(
  container: HTMLElement,
  arrayBuffer: ArrayBuffer,
  register: (p: PptxPreviewer) => void,
  opts?: { firstSlideOnly?: boolean },
): Promise<void> {
  const width = container.clientWidth || container.offsetWidth || 640;
  let slideCount = await renderOnce(container, arrayBuffer, width, register);
  if (slideCount === 0) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const ctFile = zip.file('[Content_Types].xml');
    if (ctFile) {
      const ctXml = await ctFile.async('string');
      const cleaned = ctXml.replace(/<Override\b[^>]*\/>/g, tag => {
        const m = tag.match(/PartName="([^"]*)"/);
        return m && zip.file(m[1].replace(/^\//, '')) ? tag : '';
      });
      zip.file('[Content_Types].xml', cleaned);
      slideCount = await renderOnce(
        container,
        await zip.generateAsync({ type: 'arraybuffer' }),
        width,
        register,
      );
    }
  }
  if (slideCount === 0) {
    throw new Error('预览失败：该文件与站内预览器不兼容，请下载后用本地 Office 打开');
  }
  if (opts?.firstSlideOnly) {
    // 卡片内联预览只保留第一页作缩略图(2026-09-18 用户反馈:逐页平铺太占对话流);
    // 完整翻页在右侧预览栏进行
    container.querySelectorAll('.pptx-preview-slide-wrapper').forEach((el, i) => {
      if (i > 0) el.remove();
    });
  }
}
