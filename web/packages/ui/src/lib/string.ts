import { format } from "date-fns";

export function normalize(path: string): string {
  if (!path) return "";
  const qIndex = path.indexOf("?");
  const hIndex = path.indexOf("#");
  const end =
    qIndex === -1 ? (hIndex === -1 ? path.length : hIndex) : hIndex === -1 ? qIndex : Math.min(qIndex, hIndex);
  const cleanPath = path.slice(0, end);
  if (cleanPath.length <= 3) return cleanPath;

  let firstPart = "";
  let secondPart = "";
  let partCount = 0;
  const start = cleanPath.startsWith("/") ? 1 : 0;

  for (let i = start; i < cleanPath.length; i++) {
    if (cleanPath[i] === "/") {
      if (partCount === 0 && firstPart) {
        partCount++;
        continue;
      }
      if (partCount === 1 && secondPart) {
        break;
      }
      continue;
    }

    if (partCount === 0) {
      firstPart += cleanPath[i];
    } else if (partCount === 1) {
      secondPart += cleanPath[i];
    }
  }

  if (!firstPart) return "";
  if (!secondPart) return `/${firstPart}`;
  return `/${firstPart}/${secondPart}`;
}

export function formatDate(date: Date | string | null | undefined, dateFormat = "MMMM d, yyyy") {
  if (!date) return "--/--/----";
  const parsed = new Date(date);
  return format(parsed, dateFormat);
}

export function formatDateTime(date: Date | string | null | undefined, timeFormat: "24" | "12" = "12") {
  if (!date) return "--/--/---- --:-- --";
  const parsed = new Date(date);
  return timeFormat === "24" ? format(parsed, "MMMM d, yyyy HH:mm") : format(parsed, "MMMM d, yyyy h:mm a");
}

export function capitalize(str?: string) {
  if (!str) return "";
  if (str.length === 1) return str.toUpperCase();
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export const capitalizeWords = (str?: string) => {
  if (!str) return "";
  return str
    .split(" ")
    .map((word) => capitalize(word))
    .join(" ");
};

export function fromKebabCase(str?: string) {
  if (!str) return "";
  return str.replace(/-/g, " ");
}

export function fromPascalCase(str?: string) {
  if (!str) return "";
  return str.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function fromCamelCase(str?: string) {
  if (!str) return "";
  return str.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function fromSnakeCase(str?: string) {
  if (!str) return "";
  return str.replace(/_/g, " ");
}

export function toKebabCase(str?: string) {
  if (!str) return "";
  return str.toLowerCase().replace(/ /g, "-");
}

export function toPascalCase(str?: string) {
  if (!str) return "";
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/ /g, "")
    .replace(/^./, (str) => str.toUpperCase());
}

export function toCamelCase(str?: string) {
  if (!str) return "";
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/ /g, "")
    .replace(/^./, (str) => str.toLowerCase());
}

export function toSnakeCase(str?: string) {
  if (!str) return "";
  return str.toLowerCase().replace(/ /g, "_");
}

export const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
