// Notification bridge — avoids circular imports between auto-tick and telegram
type NotifyFn = (agentId: string, message: string) => void;
let _notifyFn: NotifyFn = () => {};

export function setNotifyFn(fn: NotifyFn): void {
  _notifyFn = fn;
}

export function notifyTelegram(agentId: string, message: string): void {
  _notifyFn(agentId, message);
}
