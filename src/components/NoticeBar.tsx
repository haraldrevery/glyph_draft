import { useNoticeStore } from "../state/noticeStore";

/** Header line for file-operation notices (see noticeStore), with a dismiss button. */
export function NoticeBar() {
  const notice = useNoticeStore((s) => s.notice);
  const dismiss = useNoticeStore((s) => s.dismiss);
  if (!notice) return null;
  return (
    <span className={`notice${notice.kind === "error" ? " notice-err" : ""}`} role="status" aria-live="polite">
      {notice.message}
      <button type="button" className="notice-dismiss" aria-label="Dismiss" onClick={dismiss}>
        ×
      </button>
    </span>
  );
}
