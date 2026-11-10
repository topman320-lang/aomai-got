/** What the 訊息 pane should show.
 * Cancelled-offer notices are not rows. The empty line is only for a pane with nothing else. */

export function messagesPane({ threadCount = 0, noticeCount = 0, failed = false } = {}) {
  const threads = Math.max(0, Number(threadCount) || 0);
  const notices = Math.max(0, Number(noticeCount) || 0);
  if (failed && threads === 0) return 'error';
  if (threads === 0 && notices === 0) return 'empty';
  return 'list';
}
