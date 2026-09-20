# 主转换流程(M8):HTML → python-pptx → .pptx
# 职责:演示文稿初始化(尺寸/字体)→ 按 section 切页 → 逐块渲染 → 落盘(N5:先写临时文件再改名)
import os

from bs4 import BeautifulSoup, NavigableString, Tag
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches

from . import decorations, images, theme
from .element_map import (
    _DEFAULT_BODY_SIZE_PT,
    _HEADING_SIZES,
    add_cover_subtitle,
    add_cover_title,
    add_page_title,
    parse_inline_style,
    render_list,
    render_paragraph,
)
from .errors import HtmlParseError, WriteFailedError
from .images import ImageError, add_placeholder_shape, load_image_bytes, resolve_display_width_inches
from .layout import SlideLayout, apply_slide_size, estimate_list_height, estimate_text_height
from .page_css import parse_page_config
from .section_model import split_sections


class _Ctx:
    """渲染上下文:贯穿整个转换过程的共享状态。"""

    def __init__(self, body_font: str, output_dir: str):
        self.body_font = body_font
        self.output_dir = output_dir
        self.warnings: list[dict] = []


def convert(html: str, output_path: str) -> dict:
    """入口:HTML 字符串 + 输出路径 → 结果契约 dict。"""
    soup = BeautifulSoup(html, 'lxml')
    body = soup.body or soup
    if not body.find(True) and not (body.get_text() or '').strip():
        raise HtmlParseError('HTML 中没有可转换的内容')

    config = parse_page_config(soup)

    prs = Presentation()
    apply_slide_size(prs, config['width_px'], config['height_px'])

    ctx = _Ctx(config['body_font'],
               os.path.dirname(os.path.abspath(output_path)) or '.')

    sections = split_sections(body)
    for s_idx, section_elements in enumerate(sections):
        _render_slide(prs, section_elements, ctx, s_idx == 0)

    # 落盘(N5):先写 .tmp,成功后原子改名;失败清理残件
    tmp_path = output_path + '.tmp'
    try:
        parent = os.path.dirname(os.path.abspath(output_path))
        if parent and not os.path.isdir(parent):
            raise WriteFailedError(f'输出目录不存在: {parent}')
        prs.save(tmp_path)
        os.replace(tmp_path, output_path)
    except WriteFailedError:
        _cleanup(tmp_path)
        raise
    except OSError as e:
        _cleanup(tmp_path)
        raise WriteFailedError(f'写入输出文件失败: {e}', detail=output_path) from e

    return {'ok': True, 'outputPath': output_path, 'warnings': ctx.warnings}


# ---- slide 渲染 ----

def _render_slide(prs, section_elements: list, ctx: _Ctx, is_first: bool) -> None:
    """渲染一节(一个 <section> 或 fallback 的一组元素)为一页 slide。"""
    layout_geom = SlideLayout(prs.slide_width.inches, prs.slide_height.inches)

    # 确定显式版式
    layout_name = _resolve_layout(section_elements, is_first)
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # 空白版式

    # 提取标题(第一个 h1)
    title_text = ''
    blocks = _collect_blocks(section_elements)
    for b in blocks:
        if b.name.lower() == 'h1':
            title_text = _plain_text(b)
            break

    if layout_name == 'title':
        # 封面:满版品牌色底压在文字下层,再渲染白色标题/副标题
        theme.apply_cover_background(slide, layout_geom.w, layout_geom.h)
        _render_title_slide(slide, blocks, title_text, ctx, layout_geom)
    elif layout_name == 'two-col':
        _add_page_chrome(slide, title_text, ctx, layout_geom)
        _render_two_col(slide, blocks, ctx, layout_geom)
    elif layout_name == 'image-full':
        _add_page_chrome(slide, title_text, ctx, layout_geom)
        _render_image_full(slide, blocks, ctx, layout_geom)
    else:
        _add_page_chrome(slide, title_text, ctx, layout_geom)
        _render_content(slide, blocks, ctx, layout_geom)


def _add_page_chrome(slide, title_text: str, ctx: _Ctx, layout: SlideLayout) -> None:
    """内容页统一"页眉装饰":顶部品牌色条 + 页标题 + 标题区下分隔线。"""
    theme.add_top_accent(slide, layout.w)
    add_page_title(slide, title_text, ctx.body_font, layout)
    _, title_y, _, title_h = layout.title_rect
    theme.add_title_divider(slide, layout.margin, title_y + title_h + 0.06, layout.w - layout.margin * 2)


def _resolve_layout(section_elements: list, is_first: bool) -> str:
    """返回 title|content|two-col|image-full。"""
    first = section_elements[0] if section_elements else None
    if isinstance(first, Tag) and first.name.lower() == 'section':
        layout = (first.get('data-layout') or '').strip().lower()
        if layout in ('title', 'content', 'two-col', 'image-full'):
            return layout
        # 首个 section 缺省 title,其余缺省 content
        return 'title' if is_first else 'content'
    return 'title' if is_first else 'content'


def _collect_blocks(section_elements: list) -> list[Tag]:
    """把 section 标签(或 fallback)的块级子元素展平成列表。"""
    blocks: list[Tag] = []
    for el in section_elements:
        if isinstance(el, Tag) and el.name.lower() == 'section':
            for child in el.children:
                if isinstance(child, Tag):
                    blocks.append(child)
        elif isinstance(el, Tag):
            blocks.append(el)
    return blocks


def _plain_text(el: Tag) -> str:
    """取元素内纯文本并压空白。"""
    return ' '.join(el.stripped_strings)


# ---- 标题页 ----

def _render_title_slide(slide, blocks: list[Tag], title_text: str, ctx: _Ctx, layout: SlideLayout) -> None:
    """标题页:满版品牌色底(已由 _render_slide 铺好)+ 白色大标题 + 浅色副标题。"""
    if title_text:
        # 白色小短条压在主标题上方,作设计细节
        theme.add_cover_accent_bar(slide, layout.margin + 0.06, layout.h * 0.32 - 0.32)
        add_cover_title(slide, title_text, ctx.body_font, layout, color='FFFFFF')

    # 副标题:第一个 h2 或第一个非空 p
    subtitle_text = ''
    for b in blocks:
        name = b.name.lower()
        if name == 'h1':
            continue
        if name in ('h2', 'p'):
            subtitle_text = _plain_text(b)
            if subtitle_text:
                break
    if subtitle_text:
        add_cover_subtitle(slide, subtitle_text, ctx.body_font, layout, color=theme.BRAND_SUBTLE)


# ---- 内容页 ----

def _render_content(slide, blocks: list[Tag], ctx: _Ctx, layout: SlideLayout) -> None:
    """内容页:标题区已渲染,下面按内容区逐块渲染。"""
    x, y0, w, h_avail = layout.content_rect
    cursor = y0

    for b in blocks:
        name = b.name.lower()
        if name == 'h1':
            continue
        if name == 'h2':
            bh = estimate_text_height(_plain_text(b), _HEADING_SIZES['h2'], w)
            render_paragraph(slide, b, x, cursor, w, bh, _HEADING_SIZES['h2'], ctx, bold=True)
            cursor += bh + 0.15
        elif name == 'h3':
            bh = estimate_text_height(_plain_text(b), _HEADING_SIZES['h3'], w)
            render_paragraph(slide, b, x, cursor, w, bh, _HEADING_SIZES['h3'], ctx, bold=True)
            cursor += bh + 0.12
        elif name == 'p':
            # 行内若只有 <img>,当块级图处理
            if _is_image_only(b):
                cursor = _render_block_image(slide, b.find('img'), x, cursor, w, ctx)
            else:
                bh = estimate_text_height(_plain_text(b), _DEFAULT_BODY_SIZE_PT, w)
                bh = max(bh, 0.35)
                render_paragraph(slide, b, x, cursor, w, bh, _DEFAULT_BODY_SIZE_PT, ctx)
                cursor += bh + 0.12
        elif name in ('ul', 'ol'):
            items = [_plain_text(li) for li in b.find_all('li')]
            bh = estimate_list_height(items, _DEFAULT_BODY_SIZE_PT, w)
            bh = max(bh, 0.35)
            render_list(slide, b, x, cursor, w, bh, ctx)
            cursor += bh + 0.15
        elif name == 'img':
            cursor = _render_block_image(slide, b, x, cursor, w, ctx)
        elif name == 'hr':
            decorations.render_hr(slide, x, cursor, w)
            cursor += 0.12
        elif name == 'div' and 'stat-cards' in (b.get('class') or []):
            dh = decorations.render_stat_cards(slide, b, x, cursor, w, ctx)
            cursor += dh + 0.15
        elif name == 'div' and 'callout' in (b.get('class') or []):
            dh = decorations.render_callout(slide, b, x, cursor, w, ctx)
            cursor += dh + 0.15
        # 其他标签忽略,避免未知块导致报错


# ---- 两栏页 ----

def _render_two_col(slide, blocks: list[Tag], ctx: _Ctx, layout: SlideLayout) -> None:
    """两栏:识别 .col-left / .col-right;缺省前半放左、后半放右。"""
    lx, ly0, lw, lh = layout.left_col_rect
    rx, ry0, rw, rh = layout.right_col_rect

    content_blocks = [b for b in blocks if b.name.lower() != 'h1']
    explicit_left = [b for b in content_blocks
                     if isinstance(b, Tag) and 'col-left' in (b.get('class') or [])]
    explicit_right = [b for b in content_blocks
                      if isinstance(b, Tag) and 'col-right' in (b.get('class') or [])]
    if explicit_left or explicit_right:
        left_blocks = _col_child_blocks(explicit_left)
        right_blocks = _col_child_blocks(explicit_right)
    else:
        mid = (len(content_blocks) + 1) // 2
        left_blocks = _col_child_blocks(content_blocks[:mid])
        right_blocks = _col_child_blocks(content_blocks[mid:])

    _render_col(slide, left_blocks, lx, ly0, lw, lh, ctx)
    _render_col(slide, right_blocks, rx, ry0, rw, rh, ctx)


def _col_child_blocks(col_elements: list[Tag]) -> list[Tag]:
    """把栏容器(div.col-left/right) 的块级子元素展平;非容器直接保留。"""
    out: list[Tag] = []
    for el in col_elements:
        if isinstance(el, Tag) and el.name.lower() == 'div':
            for child in el.children:
                if isinstance(child, Tag):
                    out.append(child)
        elif isinstance(el, Tag):
            out.append(el)
    return out


def _render_col(slide, blocks: list[Tag], x: float, y0: float, w: float, h: float, ctx: _Ctx) -> None:
    """在单栏内渲染块级内容。"""
    cursor = y0
    for b in blocks:
        name = b.name.lower()
        if name == 'h2':
            bh = estimate_text_height(_plain_text(b), _HEADING_SIZES['h2'], w)
            render_paragraph(slide, b, x, cursor, w, bh, _HEADING_SIZES['h2'], ctx, bold=True)
            cursor += bh + 0.12
        elif name == 'h3':
            bh = estimate_text_height(_plain_text(b), _HEADING_SIZES['h3'], w)
            render_paragraph(slide, b, x, cursor, w, bh, _HEADING_SIZES['h3'], ctx, bold=True)
            cursor += bh + 0.1
        elif name == 'p':
            if _is_image_only(b):
                cursor = _render_block_image(slide, b.find('img'), x, cursor, w, ctx)
            else:
                bh = estimate_text_height(_plain_text(b), _DEFAULT_BODY_SIZE_PT, w)
                bh = max(bh, 0.3)
                render_paragraph(slide, b, x, cursor, w, bh, _DEFAULT_BODY_SIZE_PT, ctx)
                cursor += bh + 0.1
        elif name in ('ul', 'ol'):
            items = [_plain_text(li) for li in b.find_all('li')]
            bh = estimate_list_height(items, _DEFAULT_BODY_SIZE_PT, w)
            bh = max(bh, 0.3)
            render_list(slide, b, x, cursor, w, bh, ctx)
            cursor += bh + 0.12
        elif name == 'img':
            cursor = _render_block_image(slide, b, x, cursor, w, ctx)
        elif name == 'hr':
            decorations.render_hr(slide, x, cursor, w)
            cursor += 0.1


# ---- 全图页 ----

def _render_image_full(slide, blocks: list[Tag], ctx: _Ctx, layout: SlideLayout) -> None:
    """全图页:第一个 <img> 铺满内容区,标题覆盖在图上。"""
    img_tag = None
    for b in blocks:
        if b.name.lower() == 'img':
            img_tag = b
            break
        if b.name.lower() == 'p' and _is_image_only(b):
            img_tag = b.find('img')
            break
    if img_tag is None:
        return
    x, y, w, h = layout.full_image_rect
    _add_picture(slide, img_tag, x, y, w, h, ctx, fill=True)


# ---- 图片 ----

def _is_image_only(el: Tag) -> bool:
    """p 中只含一个 img 或 img+br 时视为块级图。"""
    tags = [c for c in el.children if isinstance(c, Tag)]
    if not tags:
        return False
    if len(tags) == 1 and tags[0].name.lower() == 'img':
        return True
    if all(t.name.lower() in ('img', 'br') for t in tags):
        return True
    return False


def _render_block_image(slide, img_tag: Tag, x: float, y: float, max_width: float, ctx: _Ctx) -> float:
    """块级图片:按 width 属性显示,缺省撑满 max_width 的 80%。返回新 cursor。"""
    width_in = resolve_display_width_inches(img_tag, max_width * 0.8)
    return _add_picture(slide, img_tag, x, y, width_in, None, ctx, fill=False)


def _add_picture(slide, img_tag: Tag, x: float, y: float, width_in: float | None,
                 height_in: float | None, ctx: _Ctx, fill: bool = False) -> float:
    """把图片加入 slide,失败则灰底占位 + warning。返回占用高度。"""
    src = img_tag.get('src') or ''
    try:
        stream = load_image_bytes(src, ctx.output_dir)
    except ImageError as e:
        ctx.warnings.append({'kind': 'image_failed', 'src': src[:300], 'reason': str(e)})
        placeholder_w = width_in if width_in else 4.0
        placeholder_h = height_in if height_in else 2.5
        add_placeholder_shape(slide, x, y, placeholder_w, placeholder_h, str(e), ctx)
        return y + placeholder_h + 0.15

    from PIL import Image
    try:
        im = Image.open(stream)
        im.load()
        orig_w, orig_h = im.size
    except Exception as e:
        ctx.warnings.append({'kind': 'image_failed', 'src': src[:300], 'reason': f'图片解码失败: {e}'})
        placeholder_w = width_in if width_in else 4.0
        placeholder_h = height_in if height_in else 2.5
        add_placeholder_shape(slide, x, y, placeholder_w, placeholder_h, str(e), ctx)
        return y + placeholder_h + 0.15
    finally:
        stream.seek(0)

    aspect = orig_h / orig_w if orig_w else 1.0
    if fill:
        # 铺满给定矩形,按宽度等比,高度不够则居中裁剪视觉效果由图片比例决定
        box_w = width_in if width_in else 4.0
        display_h = box_w * aspect
        if height_in is not None and display_h > height_in:
            display_h = height_in
        slide.shapes.add_picture(stream, Inches(x), Inches(y), width=Inches(box_w))
        return y + display_h + 0.15

    # 非 fill:按指定宽度或默认 80%
    display_w = width_in if width_in else 4.0
    display_h = display_w * aspect
    slide.shapes.add_picture(stream, Inches(x), Inches(y), width=Inches(display_w))
    return y + display_h + 0.15


def _cleanup(path: str) -> None:
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass
