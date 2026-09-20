# 页面设置解析(M8):@page 规则 + body 字体
# HTML 侧契约:
#   <style> @page { size: 1280px 720px; } </style>       → 幻灯片尺寸(F6)
#   body { font-family: "微软雅黑", ... }                  → 文档级中文字体(F3)
import re

from .errors import UnsupportedStyleError

DEFAULT_WIDTH_PX = 1280
DEFAULT_HEIGHT_PX = 720
DEFAULT_BODY_FONT = '微软雅黑'


def parse_page_config(soup) -> dict:
    """从 BeautifulSoup 文档提取页面配置,返回 {width_px, height_px, body_font}。"""
    style_text = '\n'.join((style.get_text() or '') for style in soup.find_all('style'))
    config = {
        'width_px': DEFAULT_WIDTH_PX,
        'height_px': DEFAULT_HEIGHT_PX,
        'body_font': DEFAULT_BODY_FONT,
    }

    # ---- @page 解析(允许出现多个,后者覆盖前者) ----
    for block in re.findall(r'@page\s*\{([^}]*)\}', style_text, re.IGNORECASE):
        _apply_page_block(block, config)

    # ---- body 字体(F3:取 font-family 第一个字体名) ----
    body_block = re.search(r'body\s*\{([^}]*)\}', style_text, re.IGNORECASE)
    if body_block:
        m = re.search(r'font-family\s*:\s*([^;}]+)', body_block.group(1), re.IGNORECASE)
        if m:
            first = m.group(1).split(',')[0].strip().strip('"\'')
            if first:
                config['body_font'] = first
    return config


def _apply_page_block(block: str, config: dict) -> None:
    """解析单个 @page 块,处理 size(只支持 px)。"""
    m = re.search(r'size\s*:\s*([^;]+)', block, re.IGNORECASE)
    if not m:
        return
    parts = m.group(1).strip().split()
    if len(parts) != 2:
        raise UnsupportedStyleError(
            f'不支持的 @page size 写法: {m.group(1).strip()}(请用 "1280px 720px")',
            detail=f'@page 原文: {block.strip()}',
        )
    config['width_px'] = _to_px(parts[0], 'size 宽')
    config['height_px'] = _to_px(parts[1], 'size 高')


def _to_px(text: str, where: str) -> int:
    """长度值 → px。支持 px/cm/in/pt;无单位或未知单位视为不支持。"""
    m = re.match(r'^([\d.]+)\s*(px|cm|in|pt)?$', text.strip(), re.IGNORECASE)
    if not m:
        raise UnsupportedStyleError(
            f'不支持的长度值: {text!r}(位于 {where};支持 px/cm/in/pt)',
        )
    value = float(m.group(1))
    unit = (m.group(2) or 'px').lower()
    if unit == 'px':
        return int(value)
    if unit == 'cm':
        return int(value * PX_PER_CM)
    if unit == 'in':
        return int(value * 96.0)
    if unit == 'pt':
        return int(value * 96.0 / 72.0)
    raise UnsupportedStyleError(f'未处理单位: {unit}')


PX_PER_CM = 96.0 / 2.54
