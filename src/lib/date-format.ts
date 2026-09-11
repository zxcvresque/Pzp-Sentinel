/** Dates shown to people use DD/MM/YYYY consistently; API/storage values stay ISO. */
export function displayDate(value: Date | string | number | null | undefined, timeZone = "Asia/Kolkata") {
  const date = parsedDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone,
  }).format(date);
}

export function displayDateTime(value: Date | string | number | null | undefined, timeZone = "Asia/Kolkata") {
  const date = parsedDate(value);
  if (!date) return "—";
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }).format(date);
  return `${displayDate(date, timeZone)}, ${time}`;
}

function parsedDate(value: Date | string | number | null | undefined) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
