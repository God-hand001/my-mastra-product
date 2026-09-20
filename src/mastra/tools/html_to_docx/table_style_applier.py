# 表格样式(M7-T3):边框 / 表头底色 / 列宽 / 单元格内边距 / 单元格文本样式(F4)
# HTML 契约:table/thead/tbody/tr/th/td;border 属性或缺省细实线;
# th 的 background(或 style.background)为表头底色(缺省浅灰保证 AC5 可见);
# width 属性/样式 → 列宽;style.padding → 单元格内边距。
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from .decorations import set_cell_margins, shade_cell
from .element_map import apply_inline, parse_color, parse_inline_style, parse_length_emu

DEFAULT_HEADER_BG = 'F2F2F2'


def render_table(doc, table_el, ctx) -> None:
    """渲染一张表格:行收集 → 建 docx 表格 → 逐格渲染 → 样式应用。"""
    rows = table_el.find_all('tr', recursive=True)
    rows = [r for r in rows if r.find_parent('table') is table_el]  # 忽略嵌套表
    if not rows:
        return

    def cells_of(tr):
        return [c for c in tr.find_all(['td', 'th'], recursive=False)]

    col_count = max(len(cells_of(tr)) for tr in rows)
    table = doc.add_table(rows=len(rows), cols=col_count)
    table.autofit = False

    widths_emu = _collect_column_widths(rows[0], col_count)
    if widths_emu:
        _apply_fixed_layout(table)
        for row in table.rows:
            for idx, cell in enumerate(row.cells):
                if idx < len(widths_emu) and widths_emu[idx] is not None:
                    cell.width = widths_emu[idx]

    _apply_table_borders(table, table_el)

    for r_idx, (html_tr, docx_row) in enumerate(zip(rows, table.rows)):
        is_header_row = (html_tr.find_parent('thead') is not None) or \
                        all(c.name.lower() == 'th' for c in cells_of(html_tr))
        for c_idx, html_cell in enumerate(cells_of(html_tr)):
            if c_idx >= col_count:
                break
            cell = docx_row.cells[c_idx]
            para = cell.paragraphs[0]
            apply_inline(para, html_cell, {}, ctx)
            styles = parse_inline_style(html_cell)

            # 表头:加粗 + 底色(th/thead 行;底色缺省浅灰,保证 AC5"表头有背景色"可见)
            if html_cell.name.lower() == 'th' or is_header_row:
                for run in para.runs:
                    run.font.bold = True
                bg = parse_color(styles.get('background-color') or styles.get('background', '') or '') \
                    or _attr_color(html_cell) or DEFAULT_HEADER_BG
                shade_cell(cell, bg)
            else:
                bg = parse_color(styles.get('background-color') or styles.get('background', '') or '')
                if bg:
                    shade_cell(cell, bg)

            # 单元格内边距(style.padding,px → dxa)
            padding = parse_length_emu(styles.get('padding'))
            if padding is not None:
                dxa = max(0, int(padding.emu / 635))  # EMU→dxa: /635 (1dxa=635EMU)
                set_cell_margins(cell, top=dxa, bottom=dxa, left=dxa, right=dxa)

            # 单元格内文字对齐
            align = styles.get('text-align', '').lower()
            if align in ('center', 'right', 'left', 'justify'):
                from docx.enum.text import WD_ALIGN_PARAGRAPH
                para.alignment = {'center': WD_ALIGN_PARAGRAPH.CENTER, 'right': WD_ALIGN_PARAGRAPH.RIGHT,
                                  'left': WD_ALIGN_PARAGRAPH.LEFT, 'justify': WD_ALIGN_PARAGRAPH.JUSTIFY}[align]


def _attr_color(cell_el) -> str | None:
    """th 的 bgcolor 属性兜底(个别 agent 会写 bgcolor 而非样式)。"""
    return parse_color(cell_el.get('bgcolor') or '')


def _collect_column_widths(first_row, col_count) -> list:
    """从首行单元格的 width 属性/样式收集列宽(EMU);缺 None 表示该列自动。"""
    widths: list = []
    for cell_el in first_row.find_all(['td', 'th'], recursive=False):
        raw = cell_el.get('width')
        width = parse_length_emu(raw) if raw else None
        if width is None:
            styles = parse_inline_style(cell_el)
            width = parse_length_emu(styles.get('width'))
        widths.append(width)
    while len(widths) < col_count:
        widths.append(None)
    return widths


def _apply_fixed_layout(table) -> None:
    """固定布局(tblLayout fixed),否则 Word 自动列宽会盖掉设定值。"""
    tbl_pr = table._tbl.tblPr
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tbl_pr.append(layout)


def _apply_table_borders(table, table_el) -> None:
    """全边框:border 属性形如 "1px solid #ccc" 时取颜色/粗细;缺省细实线黑。"""
    color, sz = '000000', 4  # sz 单位 1/8 pt,4 = 0.5pt 细线
    raw = (table_el.get('border') or '').strip()
    if raw and raw.isdigit() and int(raw) == 0:
        from .decorations import set_table_borders_none
        set_table_borders_none(table)
        return
    styles = parse_inline_style(table_el)
    border_style = styles.get('border', '')
    if border_style:
        m_color = parse_color(border_style.split()[-1]) if border_style.split() else None
        if m_color:
            color = m_color
        import re as _re
        m_px = _re.search(r'([\d.]+)\s*px', border_style)
        if m_px:
            sz = max(2, min(48, int(float(m_px.group(1)) * 8)))

    tbl_pr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement(f'w:{edge}')
        e.set(qn('w:val'), 'single')
        e.set(qn('w:sz'), str(sz))
        e.set(qn('w:color'), color)
        borders.append(e)
    tbl_pr.append(borders)
