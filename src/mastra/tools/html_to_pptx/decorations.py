# 装饰组件(M8-T3):数据卡片 / 标注框 / 分隔线
# 实现方式:用 python-pptx 的 AutoShape(圆角矩形/直线) + 文本框组合。
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

from .element_map import apply_inline, parse_inline_style, set_run_font_ea

# data-type → (填充色, 边框色/强调色)
_CALLOUT_COLORS = {
    'info': ('E8F1FB', '2E7CD6'),
    'success': ('E8F6EC', '34A853'),
    'warning': ('FDF3E4', 'F5A623'),
    'danger': ('FBEAEA', 'D93025'),
}


def render_stat_cards(slide, el, x: float, y: float, width: float, ctx) -> float:
    """<div class="stat-cards"> 内若干 <div class="stat-card"> 横向并排。

    返回实际占用高度(英寸)。
    """
    from bs4 import Tag

    cards = [c for c in el.children if isinstance(c, Tag) and 'stat-card' in (c.get('class') or [])]
    if not cards:
        return 0.0

    gap = 0.15
    card_width = (width - gap * (len(cards) - 1)) / len(cards)
    card_height = 1.2
    for idx, card in enumerate(cards):
        left = x + idx * (card_width + gap)
        shape = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(left), Inches(y),
            Inches(card_width), Inches(card_height),
        )
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor.from_string('F5F7FA')
        shape.line.color.rgb = RGBColor.from_string('E4E7ED')

        tf = shape.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf.margin_left = Inches(0.08)
        tf.margin_right = Inches(0.08)
        tf.margin_top = Inches(0.08)
        tf.margin_bottom = Inches(0.08)

        title_el = card.find('div', class_='stat-title')
        value_el = card.find('div', class_='stat-value')

        # 第一行:标题(小灰字)
        p1 = tf.paragraphs[0]
        p1.alignment = PP_ALIGN.CENTER
        if title_el is not None:
            apply_inline(p1, title_el, {'size': 11, 'color': '808080'}, ctx)
        else:
            run = p1.add_run()
            run.text = ''

        # 第二行:数值(大号加粗)
        p2 = tf.add_paragraph()
        p2.alignment = PP_ALIGN.CENTER
        if value_el is not None:
            apply_inline(p2, value_el, {'size': 24, 'bold': True}, ctx)
        else:
            run = p2.add_run()
            run.text = ''

    return card_height + 0.15


def render_callout(slide, el, x: float, y: float, width: float, ctx) -> float:
    """<div class="callout" data-type="info|success|warning|danger">…</div>

    返回实际占用高度(英寸)。
    """
    from bs4 import Tag

    dtype = (el.get('data-type') or 'info').lower()
    bg, accent = _CALLOUT_COLORS.get(dtype, _CALLOUT_COLORS['info'])

    # 估算高度:按内部文本量
    texts = [str(t).strip() for t in el.stripped_strings]
    text = ' '.join(texts)
    approx_h = max(0.7, min(1.6, len(text) * 0.015 + 0.4))

    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(x), Inches(y),
        Inches(width), Inches(approx_h),
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(bg)
    shape.line.color.rgb = RGBColor.from_string(accent)

    # 左侧强调条:用细矩形模拟
    bar_w = 0.04
    bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y + 0.06),
        Inches(bar_w), Inches(approx_h - 0.12),
    )
    bar.fill.solid()
    bar.fill.fore_color.rgb = RGBColor.from_string(accent)
    bar.line.fill.background()

    tf = shape.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = Inches(0.18)
    tf.margin_right = Inches(0.1)
    tf.margin_top = Inches(0.1)
    tf.margin_bottom = Inches(0.1)

    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    # 过滤掉已经渲染的 stat-title/value 等内部标记,按块级子元素渲染
    first = True
    for child in el.children:
        if isinstance(child, Tag) and child.name.lower() in ('div', 'p'):
            if not first:
                p = tf.add_paragraph()
            first = False
            apply_inline(p, child, {'size': 14}, ctx)
            styles = parse_inline_style(child)
            align = styles.get('text-align', '').lower()
            if align in ('left', 'center', 'right'):
                p.alignment = PP_ALIGN.LEFT if align == 'left' else (PP_ALIGN.CENTER if align == 'center' else PP_ALIGN.RIGHT)
    if first:
        apply_inline(p, el, {'size': 14}, ctx)

    return approx_h + 0.12


def render_hr(slide, x: float, y: float, width: float) -> None:
    """<hr> → 细横线形状。"""
    line = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y),
        Inches(width), Inches(0.01),
    )
    line.fill.solid()
    line.fill.fore_color.rgb = RGBColor.from_string('DCDCDC')
    line.line.fill.background()
