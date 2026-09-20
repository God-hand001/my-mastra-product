# M12 T0 抓流验证结论（2026-09-18）

## 方法

dev server 起后用 curl 直发 `/chat/agent`，任务为「调用 project_list_files 查看项目文件」，原始 SSE 重定向留档（过程文件已清理，结论如下）。

## 实测结果

| 模型 | reasoning 相关 chunk | 流 part 类型分布 |
|---|---|---|
| deepseek/deepseek-v4-flash | **0（无）** | text-delta ×418、tool-input-delta ×17、start-step/finish-step ×3、tool-output-available ×2、tool-input-start ×2、tool-input-available ×2、text-start/end ×2、start/finish ×1、data-workspace-metadata ×1 |
| deepseek/deepseek-v4-pro | **0（无）** | 同形态，一次工具调用 |

## 工具 chunk 字段形态（flash 实测）

```json
{"type":"tool-input-start","toolCallId":"call_00_h8m2…","toolName":"project_list_files","dynamic":false}
{"type":"tool-output-available","toolCallId":"call_00_h8m2…","output":{"entries":[],"error":"未选择项目:…"}}
```

- 工具名有两种形态：裸名（`project_list_files`）与带前缀（`mastra_workspace_list_files`）；前端 `stripToolPrefix` 已覆盖。
- 流 chunk 层是 AI SDK UIMessage chunk（input-start/delta/available、output-available），前端经 @assistant-ui/react-ai-sdk 转为 `tool-call` part（ToolCallMessagePartProps），现有 ToolCallCard 已正常工作——前端 part 层无需改。

## 对任务的结论

1. **F9 降级路径即主路径**：两个 deepseek 模型经 Mastra 均不输出 reasoning。过程呈现主要靠「叙述文字 + 工具卡」两层；ReasoningBlock 仍按 task.md 实现（组件契约完整，未来换支持推理的模型即生效），但验收 AC6 的「模型产出推理时」场景在当前模型下不可达，验收按 AC7（无空区块）执行，ReasoningBlock 以代码走查 + 构造 props 验证。
2. **T10（messages.ts 微调）取消**：历史转换的假设（reasoning part、tool-invocation 嵌套形态）与实测流形态不冲突；模型不产 reasoning，历史里也不会有。防御性转换代码保留不动。
3. **ReasoningBlock 必须容忍 `status` 为 undefined**：历史消息经 messages.ts 转出的 reasoning part 无 status 字段（有 text 才推）。组件按「text 为空且非 running → 不渲染」处理即可覆盖。
4. 状态行文案的「正在思考…」分支（优先级 3/5）仍保留：无 reasoning 时它覆盖「工具调用间的决策间隙」，语义仍正确。
