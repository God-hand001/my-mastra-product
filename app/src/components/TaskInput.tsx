import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AttachmentBar, type Attachment } from './AttachmentBar';
import { AttachmentPicker } from './AttachmentPicker';
import { ModelSelect } from './ModelSelect';
import { PermissionSelect } from './PermissionSelect';
import { ConnectorPicker } from './ConnectorPicker';
import { RoleSelectMenu } from './RoleSelector';
import { useSlashSkills, SlashSkillMenu } from './SlashSkillMenu';
import type { RoleId } from '../lib/workbenchRoles';

export function TaskInput({
  onSubmit,
  attachments,
  onAttachmentsChange,
  model,
  onModelChange,
  skill,
  onSkillChange,
  injectText,
  role,
  onRoleChange,
}: {
  onSubmit: (text: string, attachments: Attachment[]) => void;
  attachments: Attachment[];
  onAttachmentsChange: (list: Attachment[]) => void;
  model: string;
  onModelChange: (id: string) => void;
  skill?: string | null;
  onSkillChange?: (next: string | null) => void;
  /** 外部注入的提示词(如首页模板点击):nonce 变化即触发填充,填入后用户可继续编辑 */
  injectText?: { text: string; nonce: number };
  /** M15:场景角色(首页创建任务时选择,随新任务写入 store 后由首条消息携带) */
  role?: RoleId;
  onRoleChange?: (id: RoleId) => void;
}) {
  const [value, setValue] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (injectText?.text) setValue(injectText.text);
  }, [injectText?.nonce]);

  // 斜杠技能菜单:输入「/」触发
  const slash = useSlashSkills({
    textareaRef,
    value,
    setText: setValue,
    onPick: (name, meta) => {
      // chip 展示需要图标;技能随消息注入提示词(user-requested-skill 机制)
      setSkillChip({ name, nameZh: meta?.nameZh, icon: meta?.icon ?? '🧩' });
      onSkillChange?.(name);
    },
  });
  // 选中技能的 chip 展示状态(name/icon),与 onSkillChange 同步
  // 选中技能的 chip 展示状态(name/icon/nameZh),与 onSkillChange 同步
  const [skillChip, setSkillChip] = useState<{ name: string; icon: string; nameZh?: string } | null>(null);

  const remaining = 5 - attachments.length;

  const submit = () => {
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    onSubmit(text, attachments);
    setValue('');
    onAttachmentsChange([]);
    // M10:技能只随本条消息携带,发送后清除
    onSkillChange?.(null);
    setSkillChip(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handlePick = (a: Attachment): boolean => {
    if (remaining <= 0) return false;
    if (attachments.some(x => x.id === a.id)) return true;
    onAttachmentsChange([...attachments, a]);
    return true;
  };

  return (
    <div className="task-input-box" style={{ position: 'relative' }}>
      {slash.open && (
        <SlashSkillMenu items={slash.items} selIndex={slash.selIndex} listRef={slash.listRef} onPick={slash.pick} />
      )}
      {skillChip && (
        <span className="skill-chip" title={`本条消息使用技能:${skillChip.nameZh ?? skillChip.name}`}>
          <span className="skill-chip-icon">{skillChip.icon}</span>
          <span className="skill-chip-name">{skillChip.nameZh ?? skillChip.name}</span>
          <button
            type="button"
            className="skill-chip-remove"
            title="移除技能"
            onClick={() => {
              setSkillChip(null);
              onSkillChange?.(null);
            }}
          >
            ×
          </button>
        </span>
      )}
      <AttachmentBar
        attachments={attachments}
        onRemove={id => onAttachmentsChange(attachments.filter(a => a.id !== id))}
      />
      <textarea
        ref={textareaRef}
        className="task-input-textarea"
        placeholder="描述任务，输入/调用技能"
        rows={3}
        value={value}
        onChange={e => {
          setValue(e.target.value);
          slash.handleInput();
        }}
        onKeyDown={e => {
          if (slash.handleKeyDown(e)) return;
          handleKeyDown(e);
        }}
        autoFocus
      />
      <div className="task-input-toolbar">
        <div className="task-input-left">
          <button className="task-input-circle" title="添加附件" onClick={() => setPickerOpen(true)}>
            +
          </button>
          {onRoleChange && (
            <RoleSelectMenu value={role ?? 'general'} onPick={onRoleChange} />
          )}
          <ConnectorPicker />
          <PermissionSelect />
        </div>
        <div className="task-input-right">
          <ModelSelect model={model} onModelChange={onModelChange} />
          <button className="task-input-circle" title="语音输入">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <button
            className="task-input-send-circle"
            title="发送"
            onClick={submit}
            disabled={!value.trim() && attachments.length === 0}
          >
            ↑
          </button>
        </div>
      </div>
      {pickerOpen && (
        <AttachmentPicker onClose={() => setPickerOpen(false)} onPick={handlePick} />
      )}
    </div>
  );
}
