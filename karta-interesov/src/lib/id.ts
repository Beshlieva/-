/** Уникальный id попытки. crypto.randomUUID доступен только в защищённом контексте (https / localhost). */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rnd = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `${rnd()}-${rnd()}-${rnd()}-${Date.now().toString(16)}`;
}
