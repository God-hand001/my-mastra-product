# M8 / M9 / M10 夜间验收报告(2026-09-15 晚 → 09-16 凌晨)

> 执行方式:Claude(主管)与 codex 协同。codex 按任务书执行 M8/M9 的转换器与工具实现;主管负责环境准备、共享文件接线(agent.ts/index.ts/setup 脚本/app.css 冲突规避)、全部验收、bug 修复与计划外问题处置。进度台账见 [overnight-plan-20260915.md](./overnight-plan-20260915.md)。

## 总览

| 里程碑 | 状态 | 断言 | 端到端 | 待人工目验 |
|--------|------|------|--------|-----------|
| M10 扩展体系 | ✅ 功能完工 | A/B 组全绿 | AC2/AC3/AC4/AC5/AC6/AC7 实测过 | 扩展面板/技能选择器视觉效果 |
| M8 PPT 生成 | ✅ 功能完工 | 28/28 | 5 页 PPT 真实对话一次交付 | PowerPoint/WPS 打开效果、pptx 预览 |
| M9 XLSX 生成 | ✅ 功能完工 | 24/24 | 两 sheet 开支表真实对话一次交付 | Excel/WPS 打开效果、SheetJS 预览 |

三份 checklist(m8/m9/m10-checklist.md)已逐项勾验并附实际结果;根 `npx tsc --noEmit`、`cd app && npx tsc --noEmit`、`cd app && npm run build` 全部干净。

## M10 扩展体系

**交付内容**
- 技能:22 个(anthropics/skills 17+ 自研 3 + M8/M9 新增);连接器:8 个(everything/filesystem/memory/sequential-thinking 走 npx;fetch/time/git/sqlite 走 `${PY}` + 官方 Python 包)
- 后端:extension-store(扫描/注册表/导入)、connector-runtime(MCPClient 单例/`${ROOT}`+`${PY}` 占位符/错误中文化/退出清理)、extension-routes 四接口、agent 接线(skills 动态 resolver + MCP 工具动态合并 + 启动预热)
- 前端:ExtensionsPage(两标签/卡片流/开关/详情抽屉/本地导入)、Sidebar 入口激活、TaskInput+ChatThread 技能选择器(SkillPicker 浮层/单选标签/发送即清/空态置灰)、requestContext.skill 全链路
- 内容引入:setup-extensions.mjs(SOURCE.md 来源声明/幂等/sqlite 示例库自动创建)

**端到端实测**(对话流日志为证)
- AC2 自动命中:简历请求 → skill_search×8 → skill 读 word-html-spec → 按技能规范规划
- AC3 手动指定:requestContext.skill=hello-test-skill → agent 调 skill 工具 → 按技能指示回复(禁用态同样强制生效)
- AC4 连接器:filesystem_list_directory 真实列目录;禁用后 agent 明确说"没有该工具"并降级
- AC5 隔离:time 改坏命令 → lastError 中文原因,其余 7 个连接器不受影响
- AC6 导入:手写 SKILL.md 经 API 导入 → 列表 source=local → 对话生效
- AC7 重启:全部 24 技能+8 连接器状态保持,导入技能不丢

**实测修正的三个 plan 假设**(详见 m10-plan「T6 实测修订」)
1. Workspace 级 skills 沙箱限定在 workspace 目录内 → resolver 迁至 Agent 级(cwd 基准 LocalSkillSource)
2. 技能清单注入按名称排序,"置首"无效 → 手动指定改为 user-requested-skill inline skill 信号
3. `@modelcontextprotocol/server-{fetch,git,sqlite,time}` 在 npm 不存在(官方这四个是 Python 包)→ 新增 `${PY}` 占位符,vendor/python 运行官方 Python 服务器;sqlite 无 `__main__` 改 `-c` 入口

## M8 PPT 生成

- 转换器:`src/mastra/tools/html_to_pptx/`(10 文件 1272 行):section 切页/四版式(title|content|two-col|image-full)/行内样式/中文字体 latin+ea 双写/图片三来源失败降级/stat-cards/callout/hr
- 工具 `html-to-pptx.ts`:description 内嵌强制 HTML 骨架(M7 小模型遵从性经验);agent.ts「PPT 生成规范」段;已注册
- 预览:PreviewPanel pptx 分支(pptx-preview,宽度实测适配)+ preview-pptx.css(独立文件避免并行冲突)
- 端到端:「嘉立创产品介绍 PPT 5 页」→ web_search×2 → html_to_pptx 一次调用 → 5 页产物(封面/两栏/数据卡×4/warning 标注框/联系方式),python-pptx 读回页数/版式/字体全吻合
- 验收产物:`src/mastra/public/workspace/嘉立创产品介绍.pptx`、`vendor/_verify_out/m8-deck.pptx`(fixture)

## M9 XLSX 生成

- recalc CLI:`src/mastra/tools/xlsx_recalc/`(formulas 求值 → xlsx zip sheet XML 直改回填缓存值,公式字符串保留;errors_found 退出码 0;动态数组/外部引用=error 不假成功)
- 受控工具 `xlsx-build.ts`:.ref 隐藏工作目录/静态安全检测(pip install、subprocess、eval 等拒绝)/60s 超时/自动重算;已注册
- 技能 `excel-generation`(自研中文):五步流程+schema_principle+三场景范式(预算表/进度表/统计卡表)
- 产物扫描:workspace-routes.ts 过滤点前缀目录,.ref 不进产物列表(plan 待验证项 2 定案)
- 端到端:「月度开支表两 sheet」→ skill → skill_read×2(准则+范式)→ xlsx_build 一次交付;SUM/SUMIF(跨表)/COUNTIF/IF(分母零保护)全部 recalc 零错误,公式+缓存值双确认
- 验收产物:`src/mastra/public/workspace/月度开支表.xlsx`

## 协同与冲突控制

- 共享文件(agent.ts / index.ts / setup 脚本 / app.css)全部由主管编辑,两个 codex 任务书明确禁改清单;事后用 git status/diff 复核 codex 未越界
- 依赖预装(python-pptx/openpyxl/formulas/pptx-preview/官方 Python MCP 包)由主管完成,codex 沙箱无需网络
- codex M8 消耗 172k tokens、M9 消耗 315k tokens,均一次交付无需返工

## 遗留与建议

1. **人工目验三处**(文件均已就位):①WPS/PowerPoint 打开两个产物文件;②桌面端打开扩展面板与技能选择器看视觉;③右侧预览打开 pptx/xlsx 看分页与数值
2. C4(F5)未单独构造"坏公式重试"场景(机制就绪,端到端未自然触发)
3. M10 面板中 4 个连接器曾有测试期间的开关残留,已全部恢复启用并经重启验证
4. 工作区历史垃圾(gen_*.js 等,均 M7 之前遗留)未动,另事清理
5. 全部改动未提交 git,建议用户目验后按里程碑分批提交

## 用户反馈修复轮(2026-09-16 上午)

用户目验后反馈三个问题,均已修复:

1. **xlsx 预览走"转网页"旧路径、表格被裁切** → 新建 `XlsxView`(SheetJS 前端直渲染):多 sheet 标签页/表头吸顶/斑马纹/按内容自适应列宽/500 行上限提示,替换 `/workspace/files/convert` 转 HTML 路径(工作区与网盘两个入口都换)。app 新增依赖 `xlsx`。
2. **PPT 满页白板没设计感** → 转换器新增 `theme.py` 设计层:封面满版品牌绿底+白色标题+白色装饰条;内容页顶部品牌色条+标题区分隔线;正文行距 1.25/列表行距 1.3+段后距(修两栏文字拥挤)。纯转换器层兜底,agent 无需写任何颜色。verify_m8_pptx.py 复跑 28/28 仍绿;已用真实对话重新生成 `嘉立创产品介绍.pptx`(5 页全带装饰,色值经 python-pptx 读回确认)。
3. pptx 预览宽度适配经复查实现正确(init 用容器实测宽+transform 缩放),截图中的裁切来自 xlsx 旧路径,已随 1 修复。

**生效方式**:前端改动需关闭并重开桌面端(`cd app-desktop && npm run desktop`);重新生成的 PPT 直接在右侧预览即可看到新设计。
