export const iso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};

export const plusDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const daysUntil = (s: string): number | null => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
};

export const addInterval = (s: string, rep: string): string => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (rep === 'daily') dt.setDate(dt.getDate() + 1);
  else if (rep === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (rep === 'monthly') dt.setMonth(dt.getMonth() + 1);
  else if (rep === 'yearly') dt.setFullYear(dt.getFullYear() + 1);
  return iso(dt);
};

export const fmtDate = (s: string): string => {
  if (!s) return '';
  const [, mon, day] = s.split('-').map(Number);
  return `${mon}/${day}`;
};
