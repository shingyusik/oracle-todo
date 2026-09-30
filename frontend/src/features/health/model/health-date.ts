// Health days use the service's fixed UTC+09:00 calendar.
export function healthCalendarDate(date: Date): string {
  return healthLocalDateTime(date).slice(0, 10);
}
export function healthLocalDateTime(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 23).replace(/\.000$/, "");
}
