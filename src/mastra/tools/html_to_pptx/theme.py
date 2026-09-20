# 主题装饰(M8 视觉增强):封面品牌色满版底、内容页顶部色条、标题区分隔线。
# 目的:让默认生成的 PPT 不再是"白板黑字"——不依赖 agent 写任何颜色,转换器层面兜底出设计感。
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches

# 品牌色(与全站设计令牌 --brand-70 对齐的深绿,白字对比度达标)
BRAND_DARK = '20803E'
# 封面副标题等次级文字用浅色(在深绿底上可读)
BRAND_SUBTLE = 'D9F2E3'
# 内容页标题下分隔线(浅暖灰,与 app.css --border-secondary 一致)
TITLE_DIVIDER = 'E5E1D9'


def _add_rect(slide, x: float, y: float, w: float, h: float, color: str) -> object:
    """加一个无描边矩形(背景/色条用)。"""
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(color)
    shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def apply_cover_background(slide, width_in: float, height_in: float) -> None:
    """封面页满版品牌色底。必须在文字之前调用,保证色块压在文字下层。"""
    _add_rect(slide, 0, 0, width_in, height_in, BRAND_DARK)


def add_cover_accent_bar(slide, x: float, y: float, w: float = 0.72, h: float = 0.065) -> None:
    """封面标题上方的白色小短条(设计细节)。"""
    _add_rect(slide, x, y, w, h, 'FFFFFF')


def add_top_accent(slide, width_in: float, h: float = 0.07) -> None:
    """内容页顶部品牌色条(全宽)。"""
    _add_rect(slide, 0, 0, width_in, h, BRAND_DARK)


def add_title_divider(slide, x: float, y: float, w: float) -> None:
    """内容页标题区下的浅色分隔线。"""
    _add_rect(slide, x, y, w, 0.016, TITLE_DIVIDER)
