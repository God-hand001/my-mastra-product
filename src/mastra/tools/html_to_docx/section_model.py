# 分节与分页模型(M7-T4):语义 <section> → 显式分页符,处理 F14 的两个边界
#
# python-docx 没有排版引擎,分页按 spec 的关键技术约束走语义分节。
# 分页实现(2026-09-15 实测定案):docx-preview 不响应 w:pageBreakBefore(解析后未使用),
# 只按显式分页符(w:br type="page")与分节符切页 —— 因此节首分页统一由 converter
# 在节首块前插入独立分页符段落(_break_paragraph),Word 与预览器行为一致:
#   - 边界一(F14):表格无法承载段前分页 → 分页符段落本身就是锚点,天然覆盖;
#   - 边界二(F14):目录等占位段落被移除 → 分页符段落独立于占位存在,分页不会丢失。
from bs4 import Tag


def split_sections(body: Tag) -> list[list[Tag]]:
    """把 body 的顶层子节点切成若干"节"(元素列表)。

    有顶层 <section> 时按 section 切;一个都没有时整篇算一节。
    纯空白文本节点忽略。
    """
    sections: list[list[Tag]] = []
    current: list[Tag] = []
    saw_section = False

    for child in body.children:
        if isinstance(child, Tag) and child.name.lower() == 'section':
            saw_section = True
            if current:
                sections.append(current)
                current = []
            sections.append([child])
            continue
        if isinstance(child, Tag):
            current.append(child)
        # 文本节点:除空白外不应出现在 body 顶层,忽略

    if current:
        sections.append(current)

    if not saw_section and len(sections) == 1:
        return sections  # 整篇一节
    return [s for s in sections if s]


def is_toc_placeholder(el: Tag) -> bool:
    """是否为目录占位:<nav data-toc>…</nav>。"""
    return el.name.lower() == 'nav' and el.has_attr('data-toc')
