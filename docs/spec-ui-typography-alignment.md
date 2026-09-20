# Spec：视觉体系对齐（字体 / 侧边栏分组 / 预览面板）

## 背景

用户反馈三处视觉问题：正文字体发虚不够黑、侧边栏三个分组（置顶/项目/最近）显示难看、右侧预览面板难看。

参考对象为豆包桌面端（CEF + Semi Design，字节开源设计系统）。本 spec 只提取**设计参数**（字号/字重/行高/颜色/间距——事实性数值，不受版权保护）与**结构思路**，不复制其代码。

## 调研结论（已从豆包 CSS 实测提取）

### 1. 字体族不是差异所在

豆包字体栈首位是 Inter，但其打包的 19 个字体文件全是 KaTeX 数学符号字体，**未内嵌 Inter**。因此它在 Windows 11 上的实际渲染与本项目一致：拉丁字符落 Segoe UI，中文落 Microsoft YaHei。

### 2. 本项目当前存在一处自我抵消的错误配置

`app.css` 的 body 现为 `font-weight: 450` + `font-synthesis: none`。Microsoft YaHei 只有 Light/Regular(400)/Bold(700) 三档，按 CSS 字体匹配规则 450 会回落到 400，而 `font-synthesis: none` 又禁止浏览器合成中间字重。**该配置等于未生效。**

同理需要说明的事实：把字重改成 500 对中文同样几乎无效（YaHei 无 500 字面，仍回落 400）。**中文变"黑"的真实杠杆是颜色与字距，不是字重。** 字重 500 只对拉丁字符生效（Segoe UI 有 Semibold）。

### 3. 豆包的排版令牌体系（`--s-font-*`）

固定「字重 + 字号/行高」配对，行高用**像素值**而非比例：

| 令牌 | 值 | 用途 |
|---|---|---|
| xs | `400 12px/18px` | 时间戳、元信息 |
| pcbody | `400 13px/20px` | PC 端正文基准 |
| small | `400 14px/22px` | 列表项、分组标题 |
| base | `400 16px/24px` | 大号正文 |
| large | `400 20px/28px` | 标题 |

每档另有 `-strong`(500) 与 `-em`(600) 变体。`chat-box.css` 中字重使用频次：500 (22次) > 400 (14次) > 600 (10次)。

### 4. 颜色：单一黑色 + 透明度分层

```
--s-color-text-primary:    #000              /* 纯黑，非深灰 */
--s-color-text-tertiary:   rgba(0,0,0,.55)
--s-color-text-quaternary: rgba(0,0,0,.3)
--s-color-border-card:     #ebebeb
```

本项目现为 `--ui-text: #17171a` / `--ui-muted: #6e6e76`，正文偏灰。

### 5. 字距：中文可读性关键

`letter-spacing: .51px` 在豆包 CSS 中出现 36 次，是中文屏显的常规手法。本项目未使用。

### 6. 圆角

`small: 3px` / `medium: 6px` / `large: 12px`

### 7. 分组标题（直接对应用户反馈的「三个分组难看」）

豆包 `.semi-collapse-header` 实测规则：

```css
color: var(--s-color-text-tertiary);   /* rgba(0,0,0,.55) */
font: 400 14px/22px;
letter-spacing: .51px;
margin: 0;
padding: 0 4px;
width: fit-content;                     /* 点击区仅与文字同宽 */
```

关键差异：`margin: 0` + `padding: 0 4px` + `width: fit-content`。本项目当前是 `margin 6px/2px` + `padding 5px 4px` + 整行宽度，既松散又让 hover 高亮铺满整行。

## 需求

### R1 建立排版令牌层

在 `app.css` `:root` 引入与豆包同构的令牌（命名用本项目风格 `--ui-*`，不照抄 `--s-*`）：

- 字体：`--ui-font-xs/pcbody/small/base/large` 及各自 `-strong`(500) `-em`(600) 变体，行高用像素
- 颜色：`--ui-text-primary: #000`、`--ui-text-secondary: rgba(0,0,0,.8)`、`--ui-text-tertiary: rgba(0,0,0,.55)`、`--ui-text-quaternary: rgba(0,0,0,.3)`
- 边框：`--ui-border-card: #ebebeb`
- 圆角：`--ui-radius-sm: 3px` / `--ui-radius-md: 6px` / `--ui-radius-lg: 12px`

保留现有 `--ui-text` / `--ui-muted` 作为别名指向新令牌，避免大范围替换引入回归。

### R2 修正 body 基础排版

- 删除 `font-synthesis: none`（它禁止字重合成）
- `font-weight` 从 450 改 500（对拉丁字符生效）
- 正文色改用 `--ui-text-primary`
- 增加 `letter-spacing: .51px`
- 行高由 `1.6` 改为与字号配对的像素值

### R3 分组标题对齐参考稿

三个分组（置顶/项目/最近）标题：

- `margin: 0`、`padding: 2px 4px`
- 标题文字用 `--ui-font-small`（400 14px/22px）+ `letter-spacing: .51px` + `--ui-text-tertiary`
- **可点击区域 `width: fit-content`**：hover 高亮只包裹文字与箭头，不铺满整行
- 相邻分组间距靠列表容器的 `margin-bottom` 控制，不靠标题的 margin 堆叠

### R4 预览面板视觉整理

- 面板背景 `--ui-bg-panel`（浅灰 `#f7f7f8`），内容卡片纯白
- 标签栏：卡片式，激活态白底 + 上方圆角 `--ui-radius-md`，非激活态透明，分隔线 `--ui-border-card`
- 标签文字 `--ui-font-pcbody`（400 13px/20px），激活态用 `-strong`(500)
- 工具栏按钮统一 28px，圆角 `--ui-radius-md`

## 非目标

- 不复制豆包任何代码
- 不引入 Semi Design 依赖
- 不改动预览面板的开合逻辑（用户已确认该项无问题）
- 不批量替换现有 `font-size`（会破坏既有布局）

## 验收

1. `cd app && npx tsc --noEmit` 通过
2. `cd app && npm run build` 通过
3. `app.css` 中不再存在 `font-synthesis: none`
4. 三个分组标题的 hover 高亮不铺满整行
5. 视觉核对：正文为纯黑而非深灰、分组标题间距紧凑
