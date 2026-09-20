# 图片嵌入(M8-T3):本地路径 / base64 内联 / 远程 URL 三来源(F4)
# 本文件由 M7 html_to_docx/images.py 改造而来(python-pptx 专用)。
# 任一失败不中断整篇转换:调用方捕获 ImageError → 占位形状 + warnings 记录。
import base64
import os
import re
from io import BytesIO

from pptx.enum.text import PP_ALIGN
from pptx.enum.text import PP_ALIGN
from .element_map import parse_inline_style, set_run_font_ea

# PPTX 原生支持的位图格式;其余用 Pillow 转成 PNG
_NATIVE_FORMATS = ('PNG', 'JPEG', 'GIF', 'BMP', 'TIFF')


class ImageError(Exception):
    """单张图片获取/解码失败,消息会进入占位文本与 warnings。"""


def load_image_bytes(src: str, base_dir: str) -> BytesIO:
    """按来源取图并归一化成 python-pptx 可用的字节流。"""
    src = (src or '').strip()
    if not src:
        raise ImageError('图片 src 为空')

    if src.startswith('data:'):
        # data:image/png;base64,xxxx
        _, _, payload = src.partition(',')
        try:
            raw = base64.b64decode(payload, validate=False)
        except Exception as e:
            raise ImageError(f'base64 解码失败: {e}') from e
        return _normalize(raw, src[:60])

    if re.match(r'^https?://', src, re.IGNORECASE):
        import httpx  # 惰性导入:仅远程图片需要

        try:
            resp = httpx.get(src, timeout=10.0, follow_redirects=True)
            resp.raise_for_status()
        except Exception as e:
            raise ImageError(f'远程图片下载失败: {e}') from e
        return _normalize(resp.content, src[:120])

    # 本地路径:相对路径基于输出文件所在目录解析
    path = src if os.path.isabs(src) else os.path.normpath(os.path.join(base_dir, src))
    if not os.path.isfile(path):
        raise ImageError(f'本地文件不存在: {path}')
    try:
        with open(path, 'rb') as f:
            raw = f.read()
    except OSError as e:
        raise ImageError(f'本地文件读取失败: {e}') from e
    return _normalize(raw, path)


def _normalize(raw: bytes, where: str) -> BytesIO:
    """用 Pillow 探测并归一化格式:原生格式直通;webp 等转 PNG;损坏则报错。"""
    from PIL import Image

    try:
        im = Image.open(BytesIO(raw))
        im.load()
        fmt = (im.format or '').upper()
    except Exception as e:
        raise ImageError(f'图片解码失败({where}): {e}') from e

    if fmt in _NATIVE_FORMATS:
        return BytesIO(raw)
    # webp 等格式 → PNG(保留透明度)
    out = BytesIO()
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA' if 'transparency' in im.info or im.mode == 'P' else 'RGB')
    im.save(out, format='PNG')
    out.seek(0)
    return out


def resolve_display_width_inches(img_tag, max_width_in: float) -> float | None:
    """解析图片显示宽度(英寸):width 属性或 style.width;超过 max_width_in 则钳制。"""
    requested_in = None
    raw = img_tag.get('width')
    if raw:
        requested_in = _parse_length_in(raw)
    if requested_in is None:
        styles = parse_inline_style(img_tag)
        if 'width' in styles:
            requested_in = _parse_length_in(styles['width'])
    if requested_in is not None and max_width_in is not None and requested_in > max_width_in:
        return max_width_in
    return requested_in


def _parse_length_in(value) -> float | None:
    """长度值 → 英寸;支持 px/cm/in/pt,缺省 px。"""
    m = re.match(r'^\s*([\d.]+)\s*(px|cm|mm|pt|in)?\s*$', str(value or ''), re.IGNORECASE)
    if not m:
        return None
    n = float(m.group(1))
    unit = (m.group(2) or 'px').lower()
    if unit == 'px':
        return n / 96.0
    if unit == 'cm':
        return n / 2.54
    if unit == 'mm':
        return n / 25.4
    if unit == 'pt':
        return n / 72.0
    return n


def add_placeholder_shape(slide, left: float, top: float, width: float, height: float,
                          reason: str, ctx) -> None:
    """图片失败时加一个灰底占位矩形并在内部标注原因。"""
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches, Pt

    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(top),
                                   Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string('D9D9D9')
    shape.line.color.rgb = RGBColor.from_string('BFBFBF')
    tf = shape.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = f'[图片加载失败: {reason}]'
    run.font.size = Pt(10)
    run.font.color.rgb = RGBColor.from_string('666666')
    set_run_font_ea(run, ctx.body_font)
