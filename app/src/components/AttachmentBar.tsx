import { formatSize } from '../lib/driveClient';

// 附件条(M2 F1):已选附件一览,可移除
export interface Attachment {
  id: string;
  name: string;
  size: number;
  text: string;
}

export function AttachmentBar({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-bar">
      {attachments.map(a => (
        <span key={a.id} className="attachment-chip">
          <span className="attachment-chip-name">📎 {a.name}</span>
          <span className="attachment-chip-size">{formatSize(a.size)}</span>
          <button
            className="attachment-chip-remove"
            title="移除附件"
            onClick={() => onRemove(a.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
