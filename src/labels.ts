import type { Config, GradeBand, Operation, Phase, QuestionType, Subject } from "./types";

export const GRADE_BANDS: { value: GradeBand; label: string }[] = [
  { value: "g12", label: "1~2학년" },
  { value: "g34", label: "3~4학년" },
  { value: "g56", label: "5~6학년" },
];

export const QUESTION_TYPES: { value: QuestionType; label: string; hint: string }[] = [
  { value: "arithmetic", label: "연산", hint: "덧셈·뺄셈·곱셈·나눗셈을 자동으로 만들어요" },
  { value: "spelling", label: "맞춤법", hint: "학년에 맞는 맞춤법 문장이 나와요" },
  { value: "proposition", label: "명제", hint: "과목을 골라 O/X 문장으로 겨뤄요" },
  { value: "custom", label: "직접 올리기", hint: "엑셀로 만든 우리 반 문제를 써요" },
];

export const SUBJECTS: { value: Subject; label: string }[] = [
  { value: "math", label: "수학" },
  { value: "science", label: "과학" },
  { value: "social", label: "사회" },
  { value: "korean", label: "국어" },
  { value: "english", label: "영어" },
];

export const OPERATIONS: { value: Operation; label: string; sign: string }[] = [
  { value: "add", label: "덧셈", sign: "+" },
  { value: "sub", label: "뺄셈", sign: "−" },
  { value: "mul", label: "곱셈", sign: "×" },
  { value: "div", label: "나눗셈", sign: "÷" },
];

// 1~2학년에는 나눗셈 교과 내용이 없다.
export const OPERATIONS_BY_BAND: Record<GradeBand, Operation[]> = {
  g12: ["add", "sub", "mul"],
  g34: ["add", "sub", "mul", "div"],
  g56: ["add", "sub", "mul", "div"],
};

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: "대기 중",
  roll: "주사위 차례",
  pick: "카드 고르는 중",
  judge: "자동 판정 대기",
  reveal: "카드 공개",
  turnEnd: "턴 정리",
  finished: "게임 끝",
};

export const DICE_OPTIONS = [
  { value: 3, label: "1~3", hint: "가장 쉬워요" },
  { value: 4, label: "1~4", hint: "권장" },
  { value: 6, label: "1~6", hint: "원본 그대로 · 5~6은 매우 어려워요" },
];

// server/bomb-game.mjs의 MIN_JUDGE_SECONDS·MAX_JUDGE_SECONDS와 같은 값을 유지해야 한다.
// 카드를 연 뒤 사람이 누르지 않고 이 범위 안에서 정한 초가 지나면 서버가 자동으로 공개한다.
export const MIN_JUDGE_SECONDS = 3;
export const MAX_JUDGE_SECONDS = 15;

export const SCORING_OPTIONS = [
  { value: "allOrNothing" as const, label: "전부 아니면 0점", hint: "원본 규칙" },
  { value: "partial" as const, label: "넘긴 만큼 점수", hint: "좌절이 적어요" },
];

export const G12_INTEGRATED_NOTE =
  "1~2학년은 과학·사회 교과가 없어 통합교과(봄·여름·가을·겨울) 수준의 문장으로 나와요.";

export function subjectLabel(value: Subject) {
  return SUBJECTS.find((item) => item.value === value)?.label ?? value;
}

export function gradeBandLabel(value: GradeBand) {
  return GRADE_BANDS.find((item) => item.value === value)?.label ?? value;
}

export function questionTypeLabel(value: QuestionType) {
  return QUESTION_TYPES.find((item) => item.value === value)?.label ?? value;
}

/**
 * 문제은행이 모자라 시작할 수 없는 설정인지 알려 준다.
 * 수업 중에 "시작"을 눌러서야 알게 되면 곤란하므로 설정 단계에서 미리 보여 준다.
 * availableQuestions가 -1이면 연산 자동 생성이라 제한이 없다.
 */
export function questionShortfall(config: Config) {
  if (config.availableQuestions < 0) return null;
  if (config.availableQuestions >= config.requiredQuestions) return null;
  return { have: config.availableQuestions, need: config.requiredQuestions };
}

/** 방 설정을 한 줄로 요약한다. 교사 대시보드 카드에 쓴다. */
export function describeConfig(config: {
  questionType: QuestionType;
  gradeBand: GradeBand;
  subject: Subject;
  operations: Operation[];
  customCount: number;
}) {
  const grade = gradeBandLabel(config.gradeBand);
  if (config.questionType === "arithmetic") {
    const signs = config.operations
      .map((op) => OPERATIONS.find((item) => item.value === op)?.sign ?? "")
      .join(" ");
    return `${grade} 연산 ${signs}`;
  }
  if (config.questionType === "spelling") return `${grade} 맞춤법`;
  if (config.questionType === "proposition") return `${grade} ${subjectLabel(config.subject)} 명제`;
  return `우리 반 문제 ${config.customCount}개`;
}
