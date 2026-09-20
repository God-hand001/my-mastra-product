# 基础元素映射(M8-T2):文本框/标题/段落/列表/行内样式/中文字体
# 契约(见 docs/spec/m8-plan.md):
#   h1 → 页标题(28pt 加粗)
#   h2 → 20pt / h3 → 16pt / p → 14pt
#   ul/ol → 两级列表(项目符号/编号,缩进)
#   行内:strong/b、em/i、u、span style(color/font-size/font-family)、text-align
#   中文字体:latin(typeface) 与 ea(typeface) 必须同时设置,否则中文回退
import re

from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Pt

# ---- 样式解析小工具 ----

_NAMED_COLORS = {
    'black': '000000', 'white': 'FFFFFF', 'red': 'FF0000', 'green': '008000',
    'blue': '0000FF', 'yellow': 'FFFF00', 'orange': 'FFA500', 'purple': '800080',
    'gray': '808080', 'grey': '808080', 'brown': 'A52A2A', 'pink': 'FFC0CB',
}

_ALIGN_MAP = {
    'left': PP_ALIGN.LEFT,
    'center': PP_ALIGN.CENTER,
    'right': PP_ALIGN.RIGHT,
    'justify': PP_ALIGN.JUSTIFY,
}

_HEADING_SIZES = {
    'h1': 28,
    'h2': 20,
    'h3': 16,
}

_DEFAULT_BODY_SIZE_PT = 14
_DEFAULT_LIST_SIZE_PT = 14


def parse_inline_style(el) -> dict:
    """把元素的 style 属性解析成 { 属性: 值 } 小写键 dict。"""
    styles: dict[str, str] = {}
    for part in (el.get('style') or '').split(';'):
        if ':' in part:
            key, value = part.split(':', 1)
            styles[key.strip().lower()] = value.strip()
    return styles


def parse_color(value: str) -> str | None:
    """CSS 颜色 → 6 位 RRGGBB;解析不了返回 None(调用方忽略,不中断转换)。"""
    value = (value or '').strip()
    if value.startswith('#'):
        h = value[1:]
        if len(h) == 3:
            h = ''.join(c * 2 for c in h)
        if len(h) == 6 and re.fullmatch(r'[0-9a-fA-F]{6}', h):
            return h.upper()
        return None
    if value.lower().startswith('rgb'):
        nums = re.findall(r'\d+', value)
        if len(nums) >= 3:
            return '%02X%02X%02X' % tuple(int(n) for n in nums[:3])
    return _NAMED_COLORS.get(value.lower())


def parse_font_size(value: str) -> int | None:
    """解析 font-size 到 Pt 整数;支持 px/pt,缺省按 px(96dpi)估算。"""
    value = (value or '').strip()
    m = re.match(r'^([\d.]+)\s*(px|pt|em|rem)?$', value, re.IGNORECASE)
    if not m:
        return None
    n = float(m.group(1))
    unit = (m.group(2) or 'px').lower()
    if unit == 'px':
        return int(round(n * 72.0 / 96.0))
    if unit == 'pt':
        return int(round(n))
    if unit in ('em', 'rem'):
        return int(round(n * _DEFAULT_BODY_SIZE_PT))
    return None


def set_run_font_ea(run, font_name: str) -> None:
    """给 run 设置中西文字体:写 a:latin 与 a:ea 的 typeface。

    python-pptx 只通过 run.font.name 写 a:latin;对中文必须再追加 a:ea,
    否则 PowerPoint/WPS 会把中文回退到默认宋体或等线。
    """
    if not font_name:
        return
    run.font.name = font_name
    r_pr = run._r.get_or_add_rPr()

    # 确保 a:latin 存在并写入字体
    latin = r_pr.find(qn('a:latin'))
    if latin is None:
        latin = r_pr.makeelement(qn('a:latin'), {'typeface': font_name})
        r_pr.append(latin)
    else:
        latin.set('typeface', font_name)

    # 追加/更新 a:ea
    ea = r_pr.find(qn('a:ea'))
    if ea is None:
        ea = r_pr.makeelement(qn('a:ea'), {'typeface': font_name})
        r_pr.append(ea)
    else:
        ea.set('typeface', font_name)


# ---- 文本框创建 ----

def add_textbox(slide, left: float, top: float, width: float, height: float,
                text: str = '', font_size_pt: int = _DEFAULT_BODY_SIZE_PT,
                bold: bool = False, color: str | None = None,
                align: str = 'left', font_name: str | None = None,
                vertical_anchor=MSO_ANCHOR.TOP) -> object:
    """在 slide 上添加一个文本框并返回 shape;内部已完成字体/对齐初始化。"""
    from pptx.util import Inches

    shape = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = shape.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = vertical_anchor
    p = tf.paragraphs[0]
    p.alignment = _ALIGN_MAP.get(align, PP_ALIGN.LEFT)
    p.level = 0
    run = p.add_run()
    run.text = text
    run.font.size = Pt(font_size_pt)
    run.font.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    set_run_font_ea(run, font_name or '微软雅黑')
    return shape


def add_page_title(slide, text: str, font_name: str, layout) -> object:
    """h1 作为页标题渲染在 title_rect。"""
    x, y, w, h = layout.title_rect
    return add_textbox(slide, x, y, w, h, text=text, font_size_pt=_HEADING_SIZES['h1'],
                       bold=True, align='left', font_name=font_name,
                       vertical_anchor=MSO_ANCHOR.MIDDLE)


def add_cover_title(slide, text: str, font_name: str, layout, color: str | None = None) -> object:
    """标题页主标题:大字号居中(封面满版色底时传白色)。"""
    x, y, w, h = layout.cover_title_rect
    return add_textbox(slide, x, y, w, h, text=text, font_size_pt=44,
                       bold=True, color=color, align='center', font_name=font_name,
                       vertical_anchor=MSO_ANCHOR.MIDDLE)


def add_cover_subtitle(slide, text: str, font_name: str, layout, color: str | None = None) -> object:
    """标题页副标题:18pt 居中(封面满版色底时传浅色)。"""
    x, y, w, h = layout.cover_subtitle_rect
    return add_textbox(slide, x, y, w, h, text=text, font_size_pt=18,
                       bold=False, color=color, align='center', font_name=font_name,
                       vertical_anchor=MSO_ANCHOR.MIDDLE)


# ---- 行内渲染 ----

def apply_inline(paragraph, node, base: dict, ctx) -> None:
    """把行内内容(文本 + strong/em/u/span/a/br 等)渲染进段落。

    ctx 需提供:body_font(默认字体)。
    """
    from bs4 import NavigableString, Tag

    for child in node.children:
        if isinstance(child, NavigableString):
            text = re.sub(r'\s+', ' ', str(child))
            if not text:
                continue
            run = paragraph.add_run()
            run.text = text
            _style_run(run, base, ctx)
            continue
        if not isinstance(child, Tag):
            continue

        name = child.name.lower()
        if name in ('strong', 'b'):
            apply_inline(paragraph, child, {**base, 'bold': True}, ctx)
        elif name in ('em', 'i'):
            apply_inline(paragraph, child, {**base, 'italic': True}, ctx)
        elif name == 'u':
            apply_inline(paragraph, child, {**base, 'underline': True}, ctx)
        elif name in ('span', 'a', 'font', 'small', 'sub', 'sup'):
            styles = parse_inline_style(child)
            nested = dict(base)
            if 'color' in styles:
                color = parse_color(styles['color'])
                if color:
                    nested['color'] = color
            if 'font-family' in styles:
                nested['font'] = styles['font-family'].split(',')[0].strip().strip('"\'')
            if 'font-size' in styles:
                size = parse_font_size(styles['font-size'])
                if size is not None:
                    nested['size'] = size
            weight = styles.get('font-weight', '')
            if weight in ('bold', 'bolder') or (weight.isdigit() and int(weight) >= 600):
                nested['bold'] = True
            if styles.get('font-style') in ('italic', 'oblique'):
                nested['italic'] = True
            if name == 'a' and child.get('href'):
                nested['underline'] = True
            apply_inline(paragraph, child, nested, ctx)
        elif name == 'br':
            run = paragraph.add_run()
            run.text = '\n'
        else:
            # 其他行内标签按普通容器透传,不丢文本
            apply_inline(paragraph, child, base, ctx)


def _style_run(run, base: dict, ctx) -> None:
    """根据 base 状态给 run 上色/加粗/斜体/下划线/字号/字体。"""
    run.font.bold = bool(base.get('bold'))
    run.font.italic = bool(base.get('italic'))
    run.font.underline = bool(base.get('underline'))
    size = base.get('size')
    run.font.size = Pt(size) if size else Pt(_DEFAULT_BODY_SIZE_PT)
    color = base.get('color')
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    set_run_font_ea(run, base.get('font') or ctx.body_font)


# ---- 块级渲染 ----

def render_paragraph(slide, el, x: float, y: float, width: float, height: float,
                     font_size_pt: int, ctx, bold: bool = False,
                     color: str | None = None, align: str = 'left') -> object:
    """通用段落/标题渲染成文本框。"""
    shape = add_textbox(slide, x, y, width, height, '', font_size_pt=font_size_pt,
                        bold=bold, color=color, align=align,
                        font_name=ctx.body_font)
    p = shape.text_frame.paragraphs[0]
    p.line_spacing = 1.25
    if bold:
        p.space_after = Pt(6)
    apply_inline(p, el, {'size': font_size_pt, 'bold': bold}, ctx)
    # 如果行内有显式颜色,可能覆盖上面的 color;这里应用段落级 align
    styles = parse_inline_style(el)
    explicit_align = styles.get('text-align', '').lower()
    if explicit_align in _ALIGN_MAP:
        p.alignment = _ALIGN_MAP[explicit_align]
    return shape


def render_list(slide, list_el, x: float, y: float, width: float, height: float,
                ctx, level: int = 0) -> object:
    """渲染 ul/ol;li 内嵌套 ul/ol 时降一级(最多两级)。"""
    from bs4 import Tag

    shape = add_textbox(slide, x, y, width, height, '', font_size_pt=_DEFAULT_LIST_SIZE_PT,
                        font_name=ctx.body_font)
    tf = shape.text_frame
    first = True

    def _walk(parent, cur_level):
        nonlocal first
        ordered = parent.name.lower() == 'ol'
        for li in parent.children:
            if not isinstance(li, Tag) or li.name.lower() != 'li':
                continue
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.level = min(cur_level, 1)
            p.alignment = PP_ALIGN.LEFT
            p.line_spacing = 1.3
            p.space_after = Pt(4)
            apply_inline(p, li, {'size': _DEFAULT_LIST_SIZE_PT}, ctx)
            # li 里直接嵌套的列表:递归降级渲染
            for nested in li.children:
                if isinstance(nested, Tag) and nested.name.lower() in ('ul', 'ol'):
                    _walk(nested, cur_level + 1)

    _walk(list_el, level)
    return shape
