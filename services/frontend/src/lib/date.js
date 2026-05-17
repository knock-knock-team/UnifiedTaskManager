export function formatDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseDateTimeLocal(value) {
  if (!value) return null;
  const [datePart, timePart] = String(value).split('T');
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split('-').map((part) => Number(part));
  const [hours, minutes] = timePart.split(':').map((part) => Number(part));
  if ([year, month, day, hours, minutes].some((part) => Number.isNaN(part))) return null;
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
