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

const EMAIL_RE = /[\w.+-]+\s?@\s?[\w-]+\s?\.\s?[\w.-]{2,}/;

/** DDDs válidos no Brasil (evita capturar horários, datas e números avulsos). */
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42,
  43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74,
  75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Palavras de interface que nunca são nome de cliente. */
const UI_NOISE =
  /(online|digitando|visto por [uú]ltimo|hoje|ontem|whats|mensagem|status|arquivad|grupo|comunidade|conversas|atualiza[çc][õo]es|chamadas|ligar|v[íi]deo|[áa]udio|criptografad|toque aqui|clique|pesquisar|buscar|nova conversa|favoritos|silenciad|fixad|bloquear|denunciar|apagar|encaminh|selecionar|salvo|contato|perfil|https?|www\.|@|\+?\d)/i;

/** Rótulos comuns em fichas/cartões que precedem o valor real. */
const NAME_LABEL = /^(nome|cliente|contato|raz[ãa]o social|respons[áa]vel)\s*[:\-]\s*/i;
const PHONE_LABEL = /(telefone|celular|whats\s?app|whats|fone|tel|contato)\s*[:\-]?/i;

/** Correções de confusões clássicas do OCR dentro de sequências numéricas. */
function fixDigits(value: string): string {
  return value
    .replace(/[Oo]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[Zz]/g, "2")
    .replace(/[Gg]/g, "6");
}

function titleCase(value: string): string {
  const small = new Set(["de", "da", "do", "das", "dos", "e"]);
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

function cleanNameCandidate(line: string): string {
  return line
    .replace(NAME_LABEL, "")
    .replace(/[^\p{L}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreName(clean: string, index: number, total: number): number {
  const words = clean.split(" ");
  if (words.length < 1 || words.length > 5) return -1;
  if (clean.length < 3 || clean.length > 60) return -1;
  if (!words.every((word) => /^\p{L}/u.test(word) && word.length >= 1)) return -1;

  let score = 0;
  if (words.length >= 2) score += 3; // nome + sobrenome
  // Capitalização típica de nome próprio.
  if (words.every((word) => /^[\p{Lu}]/u.test(word))) score += 2;
  // Linhas do topo do print costumam ser o nome do contato.
  score += Math.max(0, 3 - index);
  if (index > total * 0.6) score -= 1;
  return score;
}

function extractPhones(rawText: string): string[] {
  const found: string[] = [];
  // Trabalha linha a linha para poder priorizar linhas rotuladas.
  const lines = rawText.split(/\r?\n/);
  const candidates: { value: string; boost: number }[] = [];

  for (const line of lines) {
    const boost = PHONE_LABEL.test(line) ? 1 : 0;
    const normalized = fixDigits(line.replace(/[^\dOoIil|!SsBbZzGg()+\s.-]/g, " "));
    const matches = normalized.matchAll(
      /(\+?55)?[\s.-]*\(?(\d{2})\)?[\s.-]*(9?\d{4})[\s.-]*(\d{4})/g,
    );
    for (const match of matches) {
      const ddd = Number(match[2]);
      if (!VALID_DDD.has(ddd)) continue;
      const digits = `${match[2]}${match[3]}${match[4]}`;
      if (digits.length < 10 || digits.length > 11) continue;
      candidates.push({ value: `+55${digits}`, boost: boost + (digits.length === 11 ? 1 : 0) });
    }
  }

  candidates.sort((a, b) => b.boost - a.boost);
  for (const candidate of candidates) {
    const normalized = normalizePhone(candidate.value);
    if (normalized && !found.includes(normalized)) found.push(normalized);
  }
  return found;
}

export function parseContactFromText(text: string): LocalExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

  const email = (text.match(EMAIL_RE)?.[0] ?? "").replace(/\s/g, "").toLowerCase();
  const phone = extractPhones(text)[0] ?? "";

  let bestName = "";
  let bestScore = 0;
  lines.forEach((line, index) => {
    if (UI_NOISE.test(line) && !NAME_LABEL.test(line)) return;
    const clean = cleanNameCandidate(line);
    if (!clean) return;
    const score = scoreName(clean, index, lines.length) + (NAME_LABEL.test(line) ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestName = clean;
    }
  });

  const notes = lines
    .filter((line) => !UI_NOISE.test(line) || /\p{L}{4,}/u.test(line))
    .slice(0, 10)
    .join(" · ")
    .slice(0, 500);

  return {
    name: bestName ? titleCase(bestName) : "",
    phone,
    email,
    notes,
  };
}

export function extractionIsWeak(result: LocalExtraction): boolean {
  return !result.phone && !result.email;
}
