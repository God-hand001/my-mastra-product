# 分节与分页模型(M8):语义 <section> → 一页 slide
# 直接从 M7 html_to_docx/section_model.py 复制,仅做说明更新。
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

    if current:
        sections.append(current)

    if not saw_section and len(sections) == 1:
        return sections
    return [s for s in sections if s]
