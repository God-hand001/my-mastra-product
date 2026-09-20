# 版式计算(M8-T2):px→英寸换算 + 四种 slide 版式区域定义
# python-pptx 没有排版引擎,所有位置靠坐标硬算;溢出由 agent 修正重试。
from pptx.util import Emu, Inches, Pt

PX_PER_INCH = 96.0
DEFAULT_WIDTH_PX = 1280
DEFAULT_HEIGHT_PX = 720
MARGIN_IN = 0.5


def px_to_in(px: float) -> float:
    """px 按 96dpi 转英寸。"""
    return px / PX_PER_INCH


def apply_slide_size(prs, width_px: int, height_px: int) -> tuple[float, float]:
    """把解析到的像素尺寸写到演示文稿,返回 (宽,高) 英寸。"""
    w_in = px_to_in(width_px)
    h_in = px_to_in(height_px)
    prs.slide_width = Inches(w_in)
    prs.slide_height = Inches(h_in)
    return w_in, h_in


class SlideLayout:
    """一次 slide 的版式几何,所有尺寸统一用英寸(float)。"""

    def __init__(self, width_in: float, height_in: float, margin_in: float = MARGIN_IN):
        self.w = width_in
        self.h = height_in
        self.margin = margin_in
        self.content_top = margin_in + 1.0  # 页标题区占 1 英寸

    # ---- 通用区域 ----
    @property
    def title_rect(self) -> tuple[float, float, float, float]:
        """页标题区:左上宽高。"""
        return (
            self.margin,
            self.margin,
            self.w - self.margin * 2,
            0.9,
        )

    @property
    def content_rect(self) -> tuple[float, float, float, float]:
        """内容主区:标题区下方到页底边距。"""
        return (
            self.margin,
            self.content_top,
            self.w - self.margin * 2,
            self.h - self.content_top - self.margin,
        )

    # ---- 标题页(cover) ----
    @property
    def cover_title_rect(self) -> tuple[float, float, float, float]:
        return (
            self.margin,
            self.h * 0.32,
            self.w - self.margin * 2,
            1.2,
        )

    @property
    def cover_subtitle_rect(self) -> tuple[float, float, float, float]:
        return (
            self.margin,
            self.h * 0.52,
            self.w - self.margin * 2,
            1.0,
        )

    # ---- 两栏 ----
    @property
    def col_gap(self) -> float:
        """两栏之间的间距(英寸)。"""
        return self.w * 0.04

    @property
    def col_width(self) -> float:
        """单栏宽度:左右各 45%。"""
        return (self.w - self.margin * 2 - self.col_gap) / 2.0

    @property
    def left_col_rect(self) -> tuple[float, float, float, float]:
        return (
            self.margin,
            self.content_top,
            self.col_width,
            self.h - self.content_top - self.margin,
        )

    @property
    def right_col_rect(self) -> tuple[float, float, float, float]:
        return (
            self.margin + self.col_width + self.col_gap,
            self.content_top,
            self.col_width,
            self.h - self.content_top - self.margin,
        )

    # ---- 全图页 ----
    @property
    def full_image_rect(self) -> tuple[float, float, float, float]:
        """铺满整页,但给页标题留一点顶部透明边距。"""
        return (
            self.margin,
            self.margin + 0.4,
            self.w - self.margin * 2,
            self.h - self.margin * 2 - 0.4,
        )


# ---- 文字高度估算(用于光标推进,避免所有元素堆叠在左上角) ----
# 按中文字符近似:字宽≈字号(pt)*0.6,行高=字号*line_spacing

def estimate_text_height(text: str, font_size_pt: float, width_in: float,
                         line_spacing: float = 1.35) -> float:
    """估算文本在指定宽度下占多少英寸高度;空文本返回一个最小行高。"""
    if not text:
        return font_size_pt / 72.0 * line_spacing
    avg_char_width_in = font_size_pt / 72.0 * 0.6
    chars_per_line = max(1, int(width_in / avg_char_width_in))
    lines = max(1, -(-len(text) // chars_per_line))  # 向上取整
    return lines * font_size_pt / 72.0 * line_spacing


def estimate_list_height(items: list[str], font_size_pt: float, width_in: float,
                         line_spacing: float = 1.45) -> float:
    """估算列表总高度(含项目符号与缩进)。"""
    height = 0.0
    for item in items:
        height += estimate_text_height(item, font_size_pt, width_in * 0.92, line_spacing)
    return max(height, font_size_pt / 72.0 * line_spacing)
