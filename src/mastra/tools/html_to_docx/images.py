# 图片嵌入(M7-T5):本地路径 / base64 内联 / 远程 URL 三来源(F12)
# 任一失败不中断整篇转换:调用方捕获 ImageError → 占位段落 + warnings 记录。
import base64
import os
import re
from io import BytesIO

from .element_map import parse_inline_style, parse_length_emu

# Word/python-docx 原生支持的位图格式;其余(如 webp)用 Pillow 转成 PNG
_NATIVE_FORMATS = ('PNG', 'JPEG', 'GIF', 'BMP', 'TIFF')


class ImageError(Exception):
    """单张图片获取/解码失败,消息会进入占位文本与 warnings。"""


def load_image_bytes(src: str, base_dir: str) -> BytesIO:
    """按来源取图并归一化成 python-docx 可用的字节流。"""
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


def resolve_display_width(img_tag, content_width_emu) -> object | None:
    """解析图片显示宽度:width 属性或 style.width。

    返回 EMU 或 None(用自然尺寸)。版心宽钳制在拿到字节流后由 add_picture_to_run 完成。
    """
    if img_tag.get('width'):
        requested = parse_length_emu(img_tag.get('width'))
        if requested is not None:
            return _clamp(requested, content_width_emu)
    styles = parse_inline_style(img_tag)
    if 'width' in styles:
        requested = parse_length_emu(styles['width'])
        if requested is not None:
            return _clamp(requested, content_width_emu)
    return None


def _clamp(width_emu, content_width_emu):
    """显示宽度不超过版心宽,避免超宽大图溢出页面。"""
    if content_width_emu is not None and width_emu > content_width_emu:
        return content_width_emu
    return width_emu
