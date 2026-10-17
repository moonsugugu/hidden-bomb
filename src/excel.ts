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
  if (readAnswer(second) !== null && !/^(정답|답)$/.test(second)) return false;
  return /^(문장|문제|문제\s*내용|내용)$/.test(first) || /^(정답|답)(\s*\(.*\))?$|^o\s*\/\s*x$/i.test(second);
}

function parseDelimited(text: string, delimiter: string): unknown[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  const finishRow = () => {
    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);
    row = []; cell = "";
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell.trim()) quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      finishRow();
      if (char === "\r" && source[i + 1] === "\n") i++;
    } else cell += char;
  }
  if (quoted) throw new Error("문제 파일의 따옴표가 닫히지 않았어요. 파일을 확인해 주세요.");
  finishRow();
  return rows;
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
    const explain = String(row?.[2] ?? "").trim();
    // 서버의 문장·해설·문항 제한을 넘기면 의미를 잘라 보내지 않고 파일을 다시 고치게 한다.
    if (text.length > 160 || explain.length > 200)
      throw new Error(`${index + 1}번째 문항이 너무 길어요. 문장은 160자, 해설은 200자까지 입력해 주세요.`);
    items.push({ text, isTrue: answer, explain });
    if (items.length > 200) throw new Error("문제는 한 번에 200개까지 올릴 수 있어요.");
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
