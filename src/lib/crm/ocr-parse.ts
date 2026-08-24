/**
 * Extração local (sem custo) de dados de cadastro a partir do texto lido por OCR.
 * Roda 100% no navegador; usada antes de qualquer chamada de IA paga.
 */
import { normalizePhone } from "@/lib/domain/phone";

export type LocalExtraction = {
  name: string;
  phone: string;
  email: string;
  notes: string;
};

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const PHONE_RE = /(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g;

const IGNORE_LINE =
  /(online|digitando|hoje|ontem|whatsapp|mensagem|http|www\.|\d{1,2}:\d{2}|toque aqui)/i;

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

function guessName(lines: string[]): string {
  for (const line of lines) {
    const clean = line.replace(/[^\p{L}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
    if (clean.length < 4 || clean.length > 60) continue;
    if (IGNORE_LINE.test(line)) continue;
    const words = clean.split(" ");
    if (words.length < 2 || words.length > 5) continue;
    if (!words.every((word) => /^\p{L}/u.test(word))) continue;
    return titleCase(clean);
  }
  return "";
}

export function parseContactFromText(text: string): LocalExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const email = text.match(EMAIL_RE)?.[0]?.toLowerCase() ?? "";

  let phone = "";
  for (const match of text.matchAll(PHONE_RE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 13) {
      phone = normalizePhone(match[0]) ?? "";
      if (phone) break;
    }
  }

  const notes = lines.slice(0, 8).join(" ").slice(0, 500);

  return { name: guessName(lines), phone, email, notes };
}

export function extractionIsWeak(result: LocalExtraction): boolean {
  return !result.phone && !result.email;
}
