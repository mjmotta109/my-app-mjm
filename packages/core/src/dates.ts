import type { IsoDate, IsoWeek } from "./types.js";

/**
 * Fechas civiles como texto `YYYY-MM-DD`.
 *
 * El motor NUNCA lee el reloj del sistema: la fecha "hoy" se pasa siempre como
 * argumento. Eso es lo que hace que los tests del planificador sean estables.
 */

export class DateError extends Error {
  override readonly name = "DateError";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string): IsoDate {
  if (!ISO_DATE.test(value)) {
    throw new DateError(`Fecha inválida (se espera YYYY-MM-DD): ${value}`);
  }
  return value;
}

function toUtc(date: IsoDate): number {
  assertIsoDate(date);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** 0 = domingo … 6 = sábado (igual que `Date.getUTCDay`). */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

export function weekdayName(date: IsoDate): string {
  return WEEKDAYS[dayOfWeek(date)]!;
}

export function monthName(date: IsoDate): string {
  const month = Number(date.slice(5, 7));
  return MONTHS[month - 1]!;
}

/** "Lunes 14" */
export function formatDayShort(date: IsoDate): string {
  return `${weekdayName(date)} ${Number(date.slice(8, 10))}`;
}

/** "14 de septiembre de 2026" */
export function formatDayLong(date: IsoDate): string {
  return `${Number(date.slice(8, 10))} de ${monthName(date)} de ${date.slice(0, 4)}`;
}

/** Semana ISO 8601 (`YYYY-Www`). La semana empieza el lunes. */
export function isoWeek(date: IsoDate): IsoWeek {
  const ms = toUtc(date);
  const d = new Date(ms);
  // Jueves de la misma semana determina el año ISO.
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Lunes de la semana que contiene `date`. */
export function startOfWeek(date: IsoDate): IsoDate {
  const offset = (dayOfWeek(date) + 6) % 7;
  return addDays(date, -offset);
}
