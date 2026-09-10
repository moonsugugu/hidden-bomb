import test from "node:test";
import assert from "node:assert/strict";
import {
  generateArithmetic,
  availableOperations,
  OPERATIONS,
} from "./generators.mjs";

// 생성기와 독립적으로 식을 다시 계산해서 isTrue 표시가 실제와 맞는지 검증한다.
// 폭탄 카드가 실수로 '맞는 식'이면 게임이 성립하지 않고, 정답 카드가 틀린 식이면
// 아이들에게 틀린 수학을 가르치게 되므로 이 검증이 가장 중요하다.

const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));

function rational(numerator, denominator = 1) {
  const sign = denominator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator) || 1;
  return {
    n: (sign * numerator) / divisor,
    d: (sign * denominator) / divisor,
  };
}

const eq = (x, y) => x.n * y.d === y.n * x.d;

function parseOperand(raw) {
  const text = raw.trim();
  const fraction = text.match(/^(-?\d+)\/(-?\d+)$/);
  if (fraction) return rational(Number(fraction[1]), Number(fraction[2]));
  if (text.includes(".")) {
    const places = text.split(".")[1].length;
    return rational(Math.round(Number(text) * 10 ** places), 10 ** places);
  }
  return rational(Number(text));
}

const add = (x, y) => rational(x.n * y.d + y.n * x.d, x.d * y.d);
const sub = (x, y) => rational(x.n * y.d - y.n * x.d, x.d * y.d);
const mul = (x, y) => rational(x.n * y.n, x.d * y.d);
const div = (x, y) => rational(x.n * y.d, x.d * y.n);

/** 카드의 등식이 실제로 성립하는지 독립적으로 판정한다. */
function equationHolds(text) {
  const [leftSide, rightSide] = text.split("=");
  assert.ok(rightSide !== undefined, `등호가 없는 카드: ${text}`);
  const match = leftSide.trim().match(/^(\S+)\s*([+\-×÷])\s*(\S+)$/);
  assert.ok(match, `좌변을 해석할 수 없는 카드: ${text}`);
  const [, rawA, operator, rawB] = match;
  const a = parseOperand(rawA);
  const b = parseOperand(rawB);
  const right = rightSide.trim();

  // 나머지가 있는 나눗셈은 몫·나머지 규칙으로 따로 검증한다.
  if (right.includes("···")) {
    const [quotientText, remainderText] = right.split("···");
    const quotient = Number(quotientText);
    const remainder = Number(remainderText);
    if (!Number.isInteger(quotient) || !Number.isInteger(remainder)) return false;
    const dividend = a.n / a.d;
    const divisor = b.n / b.d;
    // 나머지는 반드시 0 이상이면서 나눗수보다 작아야 한다.
    if (remainder < 0 || remainder >= divisor) return false;
    return divisor * quotient + remainder === dividend;
  }

  const expected =
    operator === "+" ? add(a, b)
    : operator === "-" ? sub(a, b)
    : operator === "×" ? mul(a, b)
    : div(a, b);

  // 나눗셈인데 우변이 정수 하나면 나머지 없이 딱 떨어져야 한다.
  return eq(expected, parseOperand(right));
}

const BANDS = ["g12", "g34", "g56"];

for (const gradeBand of BANDS) {
  test(`${gradeBand}: 카드의 isTrue 표시가 실제 계산과 일치한다`, () => {
    for (let round = 0; round < 40; round += 1) {
      const deck = generateArithmetic({
        gradeBand,
        operations: availableOperations(gradeBand),
        count: 40,
        bombCount: 12,
      });
      for (const item of deck) {
        assert.equal(
          equationHolds(item.text),
          item.isTrue,
          `${gradeBand} / ${item.tag} / "${item.text}" 의 isTrue=${item.isTrue} 표시가 실제 계산과 다릅니다.`,
        );
      }
    }
  });

  test(`${gradeBand}: 폭탄 수와 덱 크기가 설정과 정확히 일치한다`, () => {
    const deck = generateArithmetic({
      gradeBand,
      operations: availableOperations(gradeBand),
      count: 40,
      bombCount: 12,
    });
    assert.equal(deck.length, 40);
    assert.equal(deck.filter((item) => !item.isTrue).length, 12);
  });

  test(`${gradeBand}: 모든 카드에 해설이 붙어 있다`, () => {
    const deck = generateArithmetic({ gradeBand, count: 40, bombCount: 12 });
    for (const item of deck) {
      assert.ok(item.explain && item.explain.length > 5, `해설 없음: ${item.text}`);
      assert.ok(item.id, `id 없음: ${item.text}`);
    }
  });
}

test("1~2학년에는 나눗셈 카드가 나오지 않는다", () => {
  for (let round = 0; round < 20; round += 1) {
    const deck = generateArithmetic({
      gradeBand: "g12",
      operations: OPERATIONS,
      count: 40,
      bombCount: 12,
    });
    for (const item of deck) {
      assert.ok(!item.text.includes("÷"), `1~2학년에 나눗셈이 나왔습니다: ${item.text}`);
    }
  }
});

test("선택한 연산만 덱에 들어간다", () => {
  const deck = generateArithmetic({
    gradeBand: "g34",
    operations: ["mul"],
    count: 40,
    bombCount: 12,
  });
  for (const item of deck) {
    assert.ok(item.text.includes("×"), `곱셈만 골랐는데 다른 연산이 나왔습니다: ${item.text}`);
  }
});

test("한 덱 안에서 같은 식이 반복되지 않는다", () => {
  for (const gradeBand of BANDS) {
    const deck = generateArithmetic({ gradeBand, count: 40, bombCount: 12 });
    const expressions = deck.map((item) => item.text.split("=")[0].trim());
    const duplicates = expressions.length - new Set(expressions).size;
    // 후보 고갈 시 중복을 허용하는 안전장치가 있으므로 소수의 중복만 용인한다.
    assert.ok(duplicates <= 2, `${gradeBand} 덱에 중복된 식이 ${duplicates}개 있습니다.`);
  }
});

test("폭탄 비율 0%와 100%도 처리한다", () => {
  const allSafe = generateArithmetic({ gradeBand: "g34", count: 20, bombCount: 0 });
  assert.equal(allSafe.filter((item) => !item.isTrue).length, 0);
  const allBomb = generateArithmetic({ gradeBand: "g34", count: 20, bombCount: 20 });
  assert.equal(allBomb.filter((item) => !item.isTrue).length, 20);
});
