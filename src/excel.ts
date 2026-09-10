import readXlsxFile from "read-excel-file/browser";
import type { CustomItem } from "./types";

// 선생님이 올린 엑셀은 브라우저에서 바로 읽는다. 파일이 서버로 올라가지 않는다.

const TRUE_WORDS = new Set(["o", "ㅇ", "○", "정답", "참", "true", "t", "y", "yes", "1"]);
const FALSE_WORDS = new Set(["x", "ㅌ", "×", "✕", "오답", "거짓", "폭탄", "false", "f", "n", "no", "0"]);

export type ParseResult = {
  items: CustomItem[];
  skipped: number;
  warnings: string[];
};

function readAnswer(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1 ? true : raw === 0 ? false : null;
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return null;
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return null;
}

function looksLikeHeader(row: unknown[]) {
  const first = String(row?.[0] ?? "").trim();
  const second = String(row?.[1] ?? "").trim();
  return /문장|문제|내용/.test(first) || /정답|답|o\s*\/\s*x/i.test(second);
}

function parseDelimited(text: string, delimiter: string): unknown[][] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

export function rowsToItems(rows: unknown[][]): ParseResult {
  const warnings: string[] = [];
  const body = rows.length && looksLikeHeader(rows[0]) ? rows.slice(1) : rows;
  const items: CustomItem[] = [];
  let skipped = 0;

  body.forEach((row, index) => {
    const text = String(row?.[0] ?? "").trim();
    if (!text) {
      skipped += 1;
      return;
    }
    const answer = readAnswer(row?.[1]);
    if (answer === null) {
      skipped += 1;
      if (warnings.length < 5)
        warnings.push(`${index + 2}번째 줄 "${text.slice(0, 18)}…" 의 정답 칸이 비었거나 O/X가 아니에요.`);
      return;
    }
    items.push({ text, isTrue: answer, explain: String(row?.[2] ?? "").trim() });
  });

  return { items, skipped, warnings };
}

export async function parseQuestionFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv")) {
    const rows = parseDelimited(await file.text(), name.endsWith(".tsv") ? "\t" : ",");
    return rowsToItems(rows);
  }
  const sheet = await readXlsxFile(file);
  // read-excel-file은 셀 타입을 좁게 선언해 두어서 그대로는 행 배열로 취급되지 않는다.
  return rowsToItems(sheet as unknown as unknown[][]);
}

/** 빈 양식을 내려받게 한다. 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다. */
export function downloadTemplate() {
  const lines = [
    "문장,정답(O/X),해설",
    "직각삼각형에는 직각이 한 개 있다.,O,직각이 하나 있는 삼각형이에요",
    "두 점을 곧게 이은 선을 반직선이라 한다.,X,두 점을 곧게 이은 선은 선분이에요",
    "정사각형은 직사각형이라고 할 수 있다.,O,네 각이 모두 직각이에요",
  ];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "폭탄카드_문제양식.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/** 게임이 끝난 뒤 터진 폭탄만 모아 내려받게 한다. 수업 마무리 자료로 쓴다. */
export function downloadBombReport(
  rows: { text: string; explain: string; count?: number; playerName?: string }[],
  title = "폭탄카드_오답노트",
) {
  const lines = ["문장,해설,터진 횟수"];
  for (const row of rows) {
    const escape = (value: string) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    lines.push([escape(row.text), escape(row.explain), row.count ?? 1].join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${title}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
