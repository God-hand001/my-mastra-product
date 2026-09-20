# 结构化错误定义(M8)
# 转换器内部统一抛出这些异常,由 __main__ 兜底转成结果契约 JSON。
# kind 取值:html_parse | unsupported_style | write_failed | internal


class ConvertError(Exception):
    """转换错误基类:携带 kind(结果契约里的错误类别)与人类可读中文信息。"""

    kind = 'internal'

    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail


class HtmlParseError(ConvertError):
    """HTML 无法解析或没有任何可转换内容。"""

    kind = 'html_parse'


class UnsupportedStyleError(ConvertError):
    """遇到确定不支持的样式/构造。"""

    kind = 'unsupported_style'


class WriteFailedError(ConvertError):
    """输出路径不可写、目录不存在等落盘失败。"""

    kind = 'write_failed'
