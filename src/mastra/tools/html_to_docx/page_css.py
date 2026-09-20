# 页面设置解析(M7-T4):@page 规则 + <meta name="doc-*"> 约定
# HTML 侧契约(见 docs/spec/m7-plan.md):
#   <style> @page { size: A4; margin: 2.54cm } </style>       → 纸张与页边距(F6)
#   <meta name="doc-header" content="...">                     → 页眉(F11)
#   <meta name="doc-footer" content="...{{page}}/{{pages}}..."> → 页脚,占位符转 PAGE/NUMPAGES 域(F11)
#   <meta name="doc-first-page-plain" content="true">          → 首页不带页眉页脚(F11)
#   body { font-family: "宋体", ... }                          → 文档级中文字体(F2)
import re

from .errors import UnsupportedStyleError

# 纸张尺寸(cm):只支持 A4 与 Letter,超出即报 unsupported_style(F6 明确缺省 A4)
PAPER_SIZES_CM = {
    'A4': (21.0, 29.7),
    'LETTER': (21.59, 27.94),
}

# 缺省页边距:上下 2.54cm,左右 3.18cm(Word「常规」边距)
DEFAULT_MARGINS_CM = {'top': 2.54, 'bottom': 2.54, 'left': 3.18, 'right': 3.18}


def parse_page_config(soup) -> dict:
    """从 BeautifulSoup 文档提取页面配置,返回统一形态的 dict(单位一律 cm)。"""
    style_text = '\n'.join((style.get_text() or '') for style in soup.find_all('style'))
    config = {
        'paper': 'A4',
        'margins_cm': dict(DEFAULT_MARGINS_CM),
        'header_text': None,
        'footer_text': None,
        'first_page_plain': False,
        'body_font': '宋体',
    }

    # ---- @page 解析(允许出现多个,后者覆盖前者) ----
    for block in re.findall(r'@page\s*\{([^}]*)\}', style_text, re.IGNORECASE):
        _apply_page_block(block, config)

    # ---- meta 约定 ----
    for meta in soup.find_all('meta'):
        name = (meta.get('name') or '').strip().lower()
        content = (meta.get('content') or '').strip()
        if not content:
            continue
        if name == 'doc-header':
            config['header_text'] = content
        elif name == 'doc-footer':
            config['footer_text'] = content
        elif name == 'doc-first-page-plain':
            config['first_page_plain'] = content.lower() in ('true', '1', 'yes')

    # ---- body 字体(F2:取 font-family 第一个字体名) ----
    body_block = re.search(r'body\s*\{([^}]*)\}', style_text, re.IGNORECASE)
    if body_block:
        m = re.search(r'font-family\s*:\s*([^;}]+)', body_block.group(1), re.IGNORECASE)
        if m:
            first = m.group(1).split(',')[0].strip().strip('"\'')
            if first:
                config['body_font'] = first
    return config


def _apply_page_block(block: str, config: dict) -> None:
    """解析单个 @page 块,处理 size 与 margin(含简写形态)。"""
    m = re.search(r'size\s*:\s*([A-Za-z0-9]+)', block, re.IGNORECASE)
    if m:
        paper = m.group(1).upper()
        if paper not in PAPER_SIZES_CM:
            raise UnsupportedStyleError(
                f'不支持的纸张尺寸: {m.group(1)}(仅支持 A4 / Letter)',
                detail=f'@page 原文: {block.strip()}',
            )
        config['paper'] = paper

    # 四向独立写法优先,再被简写覆盖(与 CSS 优先级一致:后出现的简写展开)
    for side in ('top', 'bottom', 'left', 'right'):
        m = re.search(rf'margin-{side}\s*:\s*([^;}}]+)', block, re.IGNORECASE)
        if m:
            config['margins_cm'][side] = _to_cm(m.group(1).strip(), f'margin-{side}')

    m = re.search(r'(?<![-\w])margin\s*:\s*([^;}}]+)', block, re.IGNORECASE)
    if m:
        parts = m.group(1).split()
        values = [_to_cm(p, 'margin') for p in parts]
        if len(values) == 1:
            top = bottom = left = right = values[0]
        elif len(values) == 2:  # CSS 简写:纵向 横向
            top = bottom = values[0]
            left = right = values[1]
        elif len(values) == 3:  # 上 横向 下
            top, left_right, bottom = values
            left = right = left_right
        elif len(values) == 4:  # 上 右 下 左
            top, right, bottom, left = values
        else:
            raise UnsupportedStyleError(f'无法解析 margin: {m.group(1)}')
        config['margins_cm'].update(top=top, bottom=bottom, left=left, right=right)


def _to_cm(text: str, where: str) -> float:
    """长度值 → cm。支持 cm/mm/in/pt/px;无单位或未知单位视为不支持(F6)。"""
    m = re.match(r'^(-?[\d.]+)\s*(cm|mm|in|pt|px)?$', text, re.IGNORECASE)
    if not m:
        raise UnsupportedStyleError(
            f'不支持的长度值: {text!r}(位于 {where};支持 cm/mm/in/pt/px)',
        )
    value = float(m.group(1))
    unit = (m.group(2) or 'cm').lower()
    if unit == 'cm':
        return value
    if unit == 'mm':
        return value / 10.0
    if unit == 'in':
        return value * 2.54
    if unit == 'pt':
        return value * 2.54 / 72.0
    return value * 2.54 / 96.0  # px 按 96dpi
