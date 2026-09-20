# 基础元素映射(M7-T2):标题/段落/列表/行内样式/中文字体
# 契约(见 docs/spec/m7-plan.md):
#   h1-h3 → Heading 1-3(规格要求至少三级,4-6 级顺带支持)
#   p / ul / ol / li → 段落与两级以上列表
#   行内:strong/b、em/i、u、span style(color/font-family)、text-align、line-height、margin
#   中文字体:ascii 与 rFonts.eastAsia 必须同时设置,否则 Word 中文回退默认字体(F2)
import re

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Emu, Pt, RGBColor

# ---- 样式解析小工具 ----

_NAMED_COLORS = {
    'black': '000000', 'white': 'FFFFFF', 'red': 'FF0000', 'green': '008000',
    'blue': '0000FF', 'yellow': 'FFFF00', 'orange': 'FFA500', 'purple': '800080',
    'gray': '808080', 'grey': '808080', 'brown': 'A52A2A', 'pink': 'FFC0CB',
}

_ALIGN_MAP = {
    'left': WD_ALIGN_PARAGRAPH.LEFT,
    'center': WD_ALIGN_PARAGRAPH.CENTER,
    'right': WD_ALIGN_PARAGRAPH.RIGHT,
    'justify': WD_ALIGN_PARAGRAPH.JUSTIFY,
}


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


def parse_length_emu(value) -> Emu | None:
    """长度值 → EMU(px/cm/mm/pt/in,缺省 px 按 96dpi);解析不了返回 None。"""
    m = re.match(r'^\s*(-?[\d.]+)\s*(px|cm|mm|pt|in)?\s*$', str(value or ''), re.IGNORECASE)
    if not m:
        return None
    n = float(m.group(1))
    unit = (m.group(2) or 'px').lower()
    if unit == 'px':
        return Emu(int(n * 9525))
    if unit == 'cm':
        return Emu(int(round(n * 360000)))
    if unit == 'mm':
        return Emu(int(round(n * 36000)))
    if unit == 'pt':
        return Emu(int(n * 12700))
    return Emu(int(n * 914400))  # in


def set_run_font(run, font_name: str | None = None) -> None:
    """给 run 设置字体:ascii/hAnsi 与 eastAsia 同名(F2 的关键——漏 eastAsia 中文必回退)。"""
    if not font_name:
        return
    run.font.name = font_name  # 写 w:rFonts 的 ascii 与 hAnsi
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.get_or_add_rFonts()
    r_fonts.set(qn('w:eastAsia'), font_name)


def set_style_font(style, font_name: str) -> None:
    """给段落/字符样式设置字体(含 eastAsia),用于 Normal 与 Heading 系列。"""
    style.font.name = font_name
    r_pr = style.element.get_or_add_rPr()
    r_fonts = r_pr.get_or_add_rFonts()
    r_fonts.set(qn('w:eastAsia'), font_name)


# ---- 行内渲染 ----

# 行内上下文继承态:粗/斜/下划线/颜色/字体。子标签在其上叠加,离开作用域即恢复。
_Base = dict


def apply_inline(paragraph, node, base: dict, ctx) -> None:
    """把行内内容(文本 + strong/em/u/span/img/a 等)渲染进段落。

    ctx 需提供:body_font(默认字体)、add_picture_to_run(run, img_tag)、warnings。
    """
    from bs4 import NavigableString, Tag

    for child in node.children:
        if isinstance(child, NavigableString):
            text = re.sub(r'\s+', ' ', str(child))
            if not text:
                continue
            run = paragraph.add_run(text)
            if base.get('bold'):
                run.font.bold = True
            if base.get('italic'):
                run.font.italic = True
            if base.get('underline'):
                run.font.underline = True
            if base.get('color'):
                run.font.rgb = RGBColor.from_string(base['color'])
            set_run_font(run, base.get('font') or ctx.body_font)
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
            weight = styles.get('font-weight', '')
            if weight in ('bold', 'bolder') or weight.isdigit() and int(weight) >= 600:
                nested['bold'] = True
            if styles.get('font-style') in ('italic', 'oblique'):
                nested['italic'] = True
            if name == 'a' and child.get('href'):  # 链接不在契约内,保文字、加下划线以示可点
                nested['underline'] = True
            apply_inline(paragraph, child, nested, ctx)
        elif name == 'br':
            paragraph.add_run().add_break()
        elif name == 'img':
            ctx.add_picture_to_run(paragraph.add_run(), child)
        else:
            # 其他行内标签按普通容器透传,不丢文本
            apply_inline(paragraph, child, base, ctx)


# ---- 块级段落 ----

def apply_paragraph_style(paragraph, el, ctx, styles: dict | None = None) -> None:
    """把元素上的 text-align / line-height / margin 应用到段落。"""
    styles = styles if styles is not None else parse_inline_style(el)
    fmt = paragraph.paragraph_format

    align = _ALIGN_MAP.get(styles.get('text-align', '').lower())
    if align is not None:
        paragraph.alignment = align

    line_height = styles.get('line-height', '')
    if line_height:
        m = re.match(r'^\s*([\d.]+)\s*$', line_height)
        if m:  # 纯数字 = 倍数行距
            fmt.line_spacing = float(m.group(1))
        else:
            length = parse_length_emu(line_height)
            if length is not None:
                fmt.line_spacing = length

    # 段间距:margin 简写展开 + margin-top/bottom 独立写法
    margin = _split_lengths(styles.get('margin', ''))
    if margin:
        if len(margin) == 1:
            top = bottom = margin[0]
        else:
            top, bottom = margin[0], (margin[2] if len(margin) >= 3 else margin[1])
        fmt.space_before = top
        fmt.space_after = bottom
    if 'margin-top' in styles:
        length = parse_length_emu(styles['margin-top'])
        if length is not None:
            fmt.space_before = length
    if 'margin-bottom' in styles:
        length = parse_length_emu(styles['margin-bottom'])
        if length is not None:
            fmt.space_after = length


def _split_lengths(value: str) -> list:
    out = []
    for part in (value or '').split():
        length = parse_length_emu(part)
        if length is not None:
            out.append(length)
    return out


_FIRST_LINE_INDENT = Pt(21)  # 中文正文惯例:首行缩进 2 字符 ≈ 21pt(按小四/12pt 字号估算)


def add_text_paragraph(doc, el, ctx, style: str | None = None) -> object:
    """渲染一个 p(或当作段落用的容器):行内内容 + 段落样式。返回段落对象。

    默认给首行加 2 字符缩进(中文公文/报告惯例);HTML 显式声明了 text-align 为
    center/right,或显式写了 text-indent,则不覆盖(封面居中文字缩进会很怪)。
    """
    paragraph = doc.add_paragraph(style=style)
    apply_inline(paragraph, el, {}, ctx)
    styles = parse_inline_style(el)
    apply_paragraph_style(paragraph, el, ctx, styles)
    align = (styles.get('text-align') or '').lower()
    if align not in ('center', 'right') and 'text-indent' not in styles:
        paragraph.paragraph_format.first_line_indent = _FIRST_LINE_INDENT
    return paragraph


def add_heading(doc, el, level: int, ctx) -> object:
    """渲染 h1-h6 → Heading 1-6(行内样式同样生效)。"""
    level = max(1, min(6, level))
    paragraph = doc.add_paragraph(style=f'Heading {level}')
    apply_inline(paragraph, el, {}, ctx)
    apply_paragraph_style(paragraph, el, ctx)
    return paragraph


def add_list(doc, list_el, ctx, level: int = 0) -> None:
    """渲染 ul/ol;li 内嵌套 ul/ol 时降一级(支持到第三级,再深拍平到 3)。"""
    ordered = list_el.name.lower() == 'ol'
    style_name = ('List Number' if ordered else 'List Bullet')
    if level > 0:
        style_name = f'{style_name} {min(level, 2) + 1}'  # List Bullet 2 / 3

    from bs4 import Tag

    for li in list_el.children:
        if not isinstance(li, Tag) or li.name.lower() != 'li':
            continue
        paragraph = doc.add_paragraph(style=style_name)
        _render_li_inline(paragraph, li, ctx)
        # li 里直接嵌套的列表:递归降级渲染
        for nested in li.children:
            if isinstance(nested, Tag) and nested.name.lower() in ('ul', 'ol'):
                add_list(doc, nested, ctx, level + 1)


def _render_li_inline(paragraph, li, ctx) -> None:
    """li 的行内内容:跳过嵌套列表本身,其余按行内渲染。"""
    from bs4 import NavigableString, Tag

    inner = type('Shim', (), {'children': [c for c in li.children
                                           if not (isinstance(c, Tag) and c.name.lower() in ('ul', 'ol'))]})()
    apply_inline(paragraph, inner, {}, ctx)
