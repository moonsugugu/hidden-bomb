import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSpelling,
  generateProposition,
  poolSize,
  BANK_STATS,
  SUBJECTS,
} from "./question-bank.mjs";

const BANDS = ["g12", "g34", "g56"];

test("맞춤법: 정답 문장과 폭탄 문장이 서로 달라야 한다", () => {
  // 두 문장이 같으면 학생이 무엇을 고쳐야 하는지 알 수 없다.
  for (const gradeBand of BANDS) {
    const deck = generateSpelling({ gradeBand, count: 100, bombCount: 0 });
    const safeTexts = new Set(deck.map((item) => item.text));
    const bombDeck = generateSpelling({ gradeBand, count: 100, bombCount: 100 });
    for (const bomb of bombDeck) {
      assert.ok(
        !safeTexts.has(bomb.text),
        `${gradeBand}: "${bomb.text}" 가 정답 문장과 폭탄 문장 양쪽에 있습니다.`,
      );
    }
  }
});

test("맞춤법: 요청한 폭탄 수를 정확히 지킨다", () => {
  for (const gradeBand of BANDS) {
    const deck = generateSpelling({ gradeBand, count: 12, bombCount: 4 });
    assert.equal(deck.length, 12);
    assert.equal(deck.filter((item) => !item.isTrue).length, 4);
  }
});

test("맞춤법: 문제은행보다 많이 요청하면 있는 만큼만 준다", () => {
  const deck = generateSpelling({ gradeBand: "g12", count: 999, bombCount: 300 });
  assert.equal(deck.length, BANK_STATS.spelling.g12);
  assert.ok(deck.length > 0);
});

test("맞춤법: 같은 문장이 한 덱에 두 번 나오지 않는다", () => {
  for (const gradeBand of BANDS) {
    const deck = generateSpelling({ gradeBand, count: 999, bombCount: 6 });
    assert.equal(new Set(deck.map((item) => item.text)).size, deck.length);
  }
});

// 4×4 격자(16장)로 시작하려면 격자 + 더미 3장 = 19장이 필요하다.
// poolSize는 폭탄 비율을 지킨 뒤 실제로 뽑히는 덱 크기를 돌려준다.
const MIN_DECK_FOR_4X4 = 19;

test("명제: 모든 과목·학년군 세트가 4×4 격자까지 감당한다", () => {
  for (const subject of SUBJECTS) {
    for (const gradeBand of BANDS) {
      const size = poolSize({ questionType: "proposition", gradeBand, subject, bombRatio: 0.3 });
      assert.ok(
        size >= MIN_DECK_FOR_4X4,
        `${subject}/${gradeBand} 는 ${size}장짜리 덱밖에 안 나옵니다. 4×4에는 ${MIN_DECK_FOR_4X4}장이 필요해요.`,
      );
    }
  }
});

test("맞춤법: 모든 학년군이 4×4 격자까지 감당한다", () => {
  for (const gradeBand of BANDS) {
    const size = poolSize({ questionType: "spelling", gradeBand });
    assert.ok(
      size >= MIN_DECK_FOR_4X4,
      `맞춤법 ${gradeBand} 문제 수가 ${size}개뿐입니다.`,
    );
  }
});

test("명제: 어떤 세트든 4×4 격자에 필요한 19장을 뽑을 수 있다", () => {
  // 실제 게임처럼 덱 40장 · 폭탄 30%로 요청했을 때를 본다.
  for (const subject of SUBJECTS) {
    for (const gradeBand of BANDS) {
      const deck = generateProposition({ subject, gradeBand, count: 40, bombCount: 12 });
      assert.ok(
        deck.length >= 19,
        `${subject}/${gradeBand} 에서 ${deck.length}장밖에 못 뽑았습니다. 4×4에는 19장이 필요해요.`,
      );
    }
  }
});

test("명제: 문제은행이 작아도 폭탄 비율은 지킨다", () => {
  // 있는 대로 담으면 폭탄이 50%까지 올라가 게임이 훨씬 어려워진다.
  // 덱을 줄이더라도 비율을 먼저 지켜야 한다.
  for (const subject of SUBJECTS) {
    for (const gradeBand of BANDS) {
      const deck = generateProposition({ subject, gradeBand, count: 40, bombCount: 12 });
      const ratio = deck.filter((item) => !item.isTrue).length / deck.length;
      assert.ok(
        ratio >= 0.24 && ratio <= 0.36,
        `${subject}/${gradeBand} 의 폭탄 비율이 ${Math.round(ratio * 100)}%입니다. 30% 근처여야 해요.`,
      );
    }
  }
});

test("poolSize는 실제로 뽑히는 덱 크기를 알려 준다", () => {
  // 화면의 "문제가 모자라요" 경고가 이 값을 쓰므로 실제와 어긋나면 안 된다.
  for (const subject of SUBJECTS) {
    for (const gradeBand of BANDS) {
      const predicted = poolSize({
        questionType: "proposition",
        gradeBand,
        subject,
        bombRatio: 0.3,
      });
      const actual = generateProposition({ subject, gradeBand, count: 999, bombCount: 300 });
      assert.equal(
        actual.length,
        predicted,
        `${subject}/${gradeBand}: 예고 ${predicted}장, 실제 ${actual.length}장`,
      );
    }
  }
});

test("명제: 모든 세트에 참·거짓이 넉넉히 들어 있다", () => {
  // 30% 비율로 19장을 채우려면 참이 최소 14개, 거짓이 최소 6개 있어야 한다.
  // 폭탄 비율 0과 1로 각각 뽑으면 참·거짓 개수를 그대로 셀 수 있다.
  for (const subject of SUBJECTS) {
    for (const gradeBand of BANDS) {
      const trues = generateProposition({ subject, gradeBand, count: 999, bombCount: 0 });
      const falses = generateProposition({ subject, gradeBand, count: 999, bombCount: 999 });
      assert.ok(
        trues.every((item) => item.isTrue),
        `${subject}/${gradeBand}: 폭탄 0% 요청에 거짓 명제가 섞였습니다.`,
      );
      assert.ok(
        falses.every((item) => !item.isTrue),
        `${subject}/${gradeBand}: 폭탄 100% 요청에 참 명제가 섞였습니다.`,
      );
      assert.ok(trues.length >= 14, `${subject}/${gradeBand} 에 참 명제가 ${trues.length}개뿐입니다.`);
      assert.ok(falses.length >= 6, `${subject}/${gradeBand} 에 거짓 명제가 ${falses.length}개뿐입니다.`);
    }
  }
});

test("명제: 폭탄 요청 수를 넘기지 않는다", () => {
  const deck = generateProposition({ subject: "math", gradeBand: "g34", count: 12, bombCount: 4 });
  assert.ok(deck.length <= 12);
  assert.ok(deck.filter((item) => !item.isTrue).length <= 4);
});

test("명제: 같은 문장이 한 덱에 두 번 나오지 않는다", () => {
  for (const subject of SUBJECTS) {
    for (const gradeBand of BANDS) {
      const deck = generateProposition({ subject, gradeBand, count: 999, bombCount: 999 });
      assert.equal(new Set(deck.map((item) => item.text)).size, deck.length);
    }
  }
});

test("모든 카드에 해설과 id가 있다", () => {
  const decks = [
    generateSpelling({ gradeBand: "g56", count: 999, bombCount: 10 }),
    generateProposition({ subject: "science", gradeBand: "g56", count: 999, bombCount: 999 }),
  ];
  for (const deck of decks) {
    for (const item of deck) {
      assert.ok(item.id, `id 없음: ${item.text}`);
      assert.ok(item.explain && item.explain.length > 3, `해설 없음: ${item.text}`);
      assert.equal(typeof item.isTrue, "boolean");
    }
  }
});
