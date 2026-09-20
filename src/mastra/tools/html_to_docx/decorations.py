# 装饰组件(M7-T5):标注框 / 分隔线 / 数据卡片(F13)
# 实现方式:python-docx 无原生"卡片/文本块",用表格模拟 —— 这是 Word 兼容性最好的做法。
#   标注框 callout → 单格表格:底纹色 + 左侧粗色条(tblBorders 左边加粗着色)
#   分隔线 hr      → 段落底边框(pBdr)
#   数据卡片组     → 无边框表格并排,每卡两行:标题(小字灰)/数值(大号加粗)
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

from .element_map import apply_inline, parse_inline_style

# data-type → (背景色, 左条色),未识别的类型按 info 处理
_CALLOUT_COLORS = {
    'info': ('E8F1FB', '2E7CD6'),
    'success': ('E8F6EC', '34A853'),
    'warning': ('FDF3E4', 'F5A623'),
    'danger': ('FBEAEA', 'D93025'),
}


def render_callout(doc, el, ctx) -> None:
    """<div class="callout" data-type="info|success|warning|danger">…</div>"""
    dtype = (el.get('data-type') or 'info').lower()
    bg, bar = _CALLOUT_COLORS.get(dtype, _CALLOUT_COLORS['info'])

    table = doc.add_table(rows=1, cols=1)
    table.autofit = False
    set_table_full_width(table)
    cell = table.cell(0, 0)
    shade_cell(cell, bg)
    set_callout_borders(table, bg, bar)
    set_cell_margins(cell, top=120, bottom=120, left=200, right=160)  # dxa(1/20 pt)

    # 卡内内容按块级渲染(通常是一段提示文字)
    _render_cell_blocks(cell, el, ctx)


def render_hr(doc, ctx) -> None:
    """<hr> → 带底边框的空段落(横线)。"""
    paragraph = doc.add_paragraph()
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '6')  # 0.75pt
    bottom.set(qn('w:color'), '999999')
    bottom.set(qn('w:space'), '1')
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def render_stat_cards(doc, el, ctx) -> None:
    """<div class="stat-cards"> 内若干 <div class="stat-card"> 并排成组。"""
    cards = [c for c in el.find_all('div', class_='stat-card', recursive=False)]
    if not cards:
        return
    table = doc.add_table(rows=2, cols=len(cards))
    table.autofit = False
    set_table_borders_none(table)
    col_width = int(9026000 / len(cards))  # 版心近似宽均分(EMU)
    for idx, card in enumerate(cards):
        title_cell = table.cell(0, idx)
        value_cell = table.cell(1, idx)
        for cell in (title_cell, value_cell):
            cell.width = col_width
        set_cell_margins(title_cell, top=80, bottom=0, left=120, right=120)
        set_cell_margins(value_cell, top=0, bottom=80, left=120, right=120)

        # 标题:小号灰字
        title_el = card.find('div', class_='stat-title')
        title_para = title_cell.paragraphs[0]
        if title_el is not None:
            apply_inline(title_para, title_el, {}, ctx)
        for run in title_para.runs:
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor.from_string('808080')

        # 数值:大号加粗
        value_el = card.find('div', class_='stat-value')
        value_para = value_cell.paragraphs[0]
        if value_el is not None:
            apply_inline(value_para, value_el, {}, ctx)
        for run in value_para.runs:
            run.font.size = Pt(20)
            run.font.bold = True


# ---- 底层 XML 工具(表格相关;converter/table_style_applier 亦复用) ----

def shade_cell(cell, hex_fill: str) -> None:
    """单元格底纹(w:shd)。"""
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), hex_fill)
    tc_pr.append(shd)


def set_callout_borders(table, bg: str, bar: str) -> None:
    """标注框边框:左侧粗色条,其余与底纹同色(视觉上无边)。"""
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    specs = {'top': (4, bg), 'bottom': (4, bg), 'right': (4, bg), 'left': (24, bar)}
    for edge, (sz, color) in specs.items():
        e = OxmlElement(f'w:{edge}')
        e.set(qn('w:val'), 'single')
        e.set(qn('w:sz'), str(sz))  # 单位 1/8 pt
        e.set(qn('w:color'), color)
        borders.append(e)
    tbl_pr.append(borders)


def set_table_borders_none(table) -> None:
    """显式无边框(数据卡片组用;缺省样式可能带网格线,必须显式关闭)。"""
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement(f'w:{edge}')
        e.set(qn('w:val'), 'none')
        borders.append(e)
    tbl_pr.append(borders)


def set_table_full_width(table) -> None:
    """表格宽度拉满版心(w:tblW pct=5000 即 100%)。"""
    tbl_pr = table._tbl.tblPr
    tbl_w = OxmlElement('w:tblW')
    tbl_w.set(qn('w:w'), '5000')
    tbl_w.set(qn('w:type'), 'pct')
    tbl_pr.append(tbl_w)


def set_cell_margins(cell, top: int = 0, bottom: int = 0, left: int = 0, right: int = 0) -> None:
    """单元格内边距(w:tcMar),参数单位 dxa(1/20 pt,1px≈15dxa)。"""
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = OxmlElement('w:tcMar')
    for side, val in (('top', top), ('bottom', bottom), ('left', left), ('right', right)):
        e = OxmlElement(f'w:{side}')
        e.set(qn('w:w'), str(val))
        e.set(qn('w:type'), 'dxa')
        tc_mar.append(e)
    tc_pr.append(tc_mar)


def _render_cell_blocks(cell, el, ctx) -> None:
    """把容器元素的块级子内容渲染进单元格(首段复用 cell 自带空段落)。"""
    from bs4 import NavigableString, Tag

    first = True
    for child in el.children:
        if isinstance(child, NavigableString):
            text = str(child).strip()
            if not text:
                continue
            para = cell.paragraphs[0] if first else cell.add_paragraph()
            first = False
            apply_inline(para, type('Shim', (), {'children': [child]})(), {}, ctx)
            continue
        if not isinstance(child, Tag):
            continue
        para = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        apply_inline(para, child, {}, ctx)
        apply_paragraph_style_if_any(para, child)
        # 块级嵌套容器再降一层(简单处理:容器内直接行内渲染)
        for sub in child.children:
            if isinstance(sub, Tag):
                sub_para = cell.add_paragraph()
                apply_inline(sub_para, sub, {}, ctx)


def apply_paragraph_style_if_any(paragraph, el) -> None:
    from .element_map import apply_paragraph_style

    styles = parse_inline_style(el)
    if styles:
        apply_paragraph_style(paragraph, el, None, styles)
