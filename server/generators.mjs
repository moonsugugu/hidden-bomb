import { randomUUID } from "node:crypto";

// 연산 카드 자동 생성기.
// 폭탄(오답) 카드는 무작위 숫자가 아니라 학생이 실제로 자주 하는 실수 패턴으로 만든다.
// 무작위 오답은 너무 티가 나서 판별 게임이 성립하지 않는다.

export const GRADE_BANDS = ["g12", "g34", "g56"];
export const OPERATIONS = ["add", "sub", "mul", "div"];

export const OPERATION_LABELS = {
  add: "덧셈",
  sub: "뺄셈",
  mul: "곱셈",
  div: "나눗셈",
};

export const GRADE_BAND_LABELS = {
  g12: "1~2학년",
  g34: "3~4학년",
  g56: "5~6학년",
};

// 1~2학년은 나눗셈을 배우지 않는다.
export const OPERATIONS_BY_BAND = {
  g12: ["add", "sub", "mul"],
  g34: ["add", "sub", "mul", "div"],
  g56: ["add", "sub", "mul", "div"],
};

const randomInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const choose = (rng, items) => items[Math.floor(rng() * items.length)];

function gcd(a, b) {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function reduceFraction(numerator, denominator) {
  const divisor = gcd(numerator, denominator) || 1;
  return [numerator / divisor, denominator / divisor];
}

// 소수는 부동소수점 오차를 피하려고 정수로 계산한 뒤 자릿수만 옮긴다.
function toDecimal(value, places) {
  const text = (value / 10 ** places).toFixed(places);
  return text.replace(/\.?0+$/, "") || "0";
}

function card({ text, isTrue, explain, tag }) {
  return { id: randomUUID().slice(0, 8), text, isTrue, explain, tag };
}

/* ── 덧셈 ─────────────────────────────────────────────── */

function addSmall(rng, wantBomb) {
  // 받아올림이 반드시 생기도록 일의 자리를 잡는다.
  const onesA = randomInt(rng, 4, 9);
  const onesB = randomInt(rng, 10 - onesA, 9);
  const a = randomInt(rng, 1, 8) * 10 + onesA;
  const b = randomInt(rng, 1, 8) * 10 + onesB;
  const answer = a + b;
  if (!wantBomb) {
    return card({
      text: `${a} + ${b} = ${answer}`,
      isTrue: true,
      explain: `${a} + ${b} = ${answer}, 받아올림까지 바르게 했어요.`,
      tag: "add-carry",
    });
  }
  // 받아올림 누락: 일의 자리에서 넘긴 10을 빼먹는다.
  return card({
    text: `${a} + ${b} = ${answer - 10}`,
    isTrue: false,
    explain: `바른 식은 ${a} + ${b} = ${answer} 입니다. 일의 자리 ${onesA}+${onesB}=${onesA + onesB} 에서 받아올림 1을 빠뜨렸어요.`,
    tag: "add-carry",
  });
}

function addLarge(rng, wantBomb) {
  // 받아올림이 한 군데도 없으면 "받아올림을 빠뜨렸다"는 해설이 거짓말이 되므로
  // 실제로 받아올림이 생기는 조합이 나올 때까지 다시 뽑는다.
  let a = 0;
  let b = 0;
  let carries = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    a = randomInt(rng, 120, 899);
    b = randomInt(rng, 120, 899);
    carries = [];
    const onesCarry = (a % 10) + (b % 10) >= 10 ? 1 : 0;
    if (onesCarry) carries.push(10);
    if ((Math.floor(a / 10) % 10) + (Math.floor(b / 10) % 10) + onesCarry >= 10) carries.push(100);
    if (carries.length) break;
  }
  const answer = a + b;
  if (!wantBomb) {
    return card({
      text: `${a} + ${b} = ${answer}`,
      isTrue: true,
      explain: `${a} + ${b} = ${answer}, 바르게 계산했어요.`,
      tag: "add-large",
    });
  }
  const drop = carries.length ? choose(rng, carries) : 10;
  return card({
    text: `${a} + ${b} = ${answer - drop}`,
    isTrue: false,
    explain: `바른 식은 ${a} + ${b} = ${answer} 입니다. ${drop === 10 ? "일" : "십"}의 자리에서 받아올림을 빠뜨렸어요.`,
    tag: "add-large",
  });
}

function addFraction(rng, wantBomb) {
  const denominators = [2, 3, 4, 5, 6, 8];
  const denomA = choose(rng, denominators);
  let denomB = choose(rng, denominators);
  while (denomB === denomA) denomB = choose(rng, denominators);
  const numerA = randomInt(rng, 1, denomA - 1);
  const numerB = randomInt(rng, 1, denomB - 1);
  const [num, den] = reduceFraction(numerA * denomB + numerB * denomA, denomA * denomB);
  const left = `${numerA}/${denomA} + ${numerB}/${denomB}`;
  if (!wantBomb) {
    return card({
      text: `${left} = ${num}/${den}`,
      isTrue: true,
      explain: `${left} = ${num}/${den}, 통분해서 바르게 계산했어요.`,
      tag: "fraction-add",
    });
  }
  // 통분하지 않고 분자끼리·분모끼리 더하는 대표적 오개념.
  return card({
    text: `${left} = ${numerA + numerB}/${denomA + denomB}`,
    isTrue: false,
    explain: `바른 답은 ${num}/${den} 입니다. 분자끼리, 분모끼리 더하면 안 되고 통분을 먼저 해야 해요.`,
    tag: "fraction-add",
  });
}

function addDecimal(rng, wantBomb) {
  const a = randomInt(rng, 11, 89); // 0.11 ~ 0.89
  const b = randomInt(rng, 1, 9) * 10; // 0.10 ~ 0.90
  const answer = a + b;
  const left = `${toDecimal(a, 2)} + ${toDecimal(b, 2)}`;
  if (!wantBomb) {
    return card({
      text: `${left} = ${toDecimal(answer, 2)}`,
      isTrue: true,
      explain: `${left} = ${toDecimal(answer, 2)}, 소수점 자리를 맞춰 바르게 더했어요.`,
      tag: "decimal-add",
    });
  }
  // 자리를 맞추지 않고 오른쪽 끝을 맞춰 더하는 실수.
  const misaligned = a + b / 10;
  return card({
    text: `${left} = ${toDecimal(misaligned, 2)}`,
    isTrue: false,
    explain: `바른 답은 ${toDecimal(answer, 2)} 입니다. 소수점끼리 자리를 맞춰 더해야 해요.`,
    tag: "decimal-add",
  });
}

/* ── 뺄셈 ─────────────────────────────────────────────── */

function subSmall(rng, wantBomb) {
  // 받아내림이 반드시 필요한 조합.
  const onesA = randomInt(rng, 0, 4);
  const onesB = randomInt(rng, onesA + 1, 9);
  const tensB = randomInt(rng, 1, 6);
  const tensA = randomInt(rng, tensB + 1, 9);
  const a = tensA * 10 + onesA;
  const b = tensB * 10 + onesB;
  const answer = a - b;
  if (!wantBomb) {
    return card({
      text: `${a} - ${b} = ${answer}`,
      isTrue: true,
      explain: `${a} - ${b} = ${answer}, 받아내림까지 바르게 했어요.`,
      tag: "sub-borrow",
    });
  }
  // 자리마다 큰 수에서 작은 수를 빼 버리는 대표적 오류.
  const wrong = (tensA - tensB) * 10 + (onesB - onesA);
  return card({
    text: `${a} - ${b} = ${wrong}`,
    isTrue: false,
    explain: `바른 답은 ${answer} 입니다. 일의 자리 ${onesA}에서 ${onesB}를 뺄 수 없으니 십의 자리에서 받아내림을 해야 해요.`,
    tag: "sub-borrow",
  });
}

function subLarge(rng, wantBomb) {
  const b = randomInt(rng, 130, 480);
  const a = randomInt(rng, b + 60, 980);
  const answer = a - b;
  if (!wantBomb) {
    return card({
      text: `${a} - ${b} = ${answer}`,
      isTrue: true,
      explain: `${a} - ${b} = ${answer}, 바르게 계산했어요.`,
      tag: "sub-large",
    });
  }
  const drop = (a % 10) < (b % 10) ? 10 : 100;
  return card({
    text: `${a} - ${b} = ${answer + drop}`,
    isTrue: false,
    explain: `바른 답은 ${answer} 입니다. ${drop === 10 ? "일" : "십"}의 자리 받아내림을 하지 않았어요.`,
    tag: "sub-large",
  });
}

function subFraction(rng, wantBomb) {
  const denominators = [2, 3, 4, 5, 6, 8];
  // "분자끼리 분모끼리 빼기" 오답이 3/3, 1/1 같은 어색한 꼴이 되면
  // 학생이 계산하지 않고도 틀렸다고 알아채므로 판별 게임이 성립하지 않는다.
  // 오답도 반드시 양의 진분수가 되는 조합만 사용한다.
  let denomA = 8;
  let denomB = 3;
  let numerA = 6;
  let numerB = 2;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const dA = choose(rng, denominators);
    const dB = choose(rng, denominators);
    const nA = randomInt(rng, 1, dA - 1);
    const nB = randomInt(rng, 1, dB - 1);
    if (dA - dB < 2) continue; // 분모끼리 빼서 1이 되는 조합 제외
    if (nA <= nB) continue; // 분자끼리 빼서 0 이하가 되는 조합 제외
    if (nA - nB >= dA - dB) continue; // 오답이 가분수가 되는 조합 제외
    if (nA * dB <= nB * dA) continue; // 실제 계산 결과가 음수인 조합 제외
    [denomA, denomB, numerA, numerB] = [dA, dB, nA, nB];
    break;
  }
  const [num, den] = reduceFraction(numerA * denomB - numerB * denomA, denomA * denomB);
  const left = `${numerA}/${denomA} - ${numerB}/${denomB}`;
  if (!wantBomb) {
    return card({
      text: `${left} = ${num}/${den}`,
      isTrue: true,
      explain: `${left} = ${num}/${den}, 통분해서 바르게 계산했어요.`,
      tag: "fraction-sub",
    });
  }
  return card({
    text: `${left} = ${numerA - numerB}/${denomA - denomB}`,
    isTrue: false,
    explain: `바른 답은 ${num}/${den} 입니다. 분자끼리, 분모끼리 빼면 안 되고 통분을 먼저 해야 해요.`,
    tag: "fraction-sub",
  });
}

/* ── 곱셈 ─────────────────────────────────────────────── */

function mulTable(rng, wantBomb) {
  const a = randomInt(rng, 2, 9);
  const b = randomInt(rng, 2, 9);
  const answer = a * b;
  if (!wantBomb) {
    return card({
      text: `${a} × ${b} = ${answer}`,
      isTrue: true,
      explain: `${a} × ${b} = ${answer}, 맞아요.`,
      tag: "mul-table",
    });
  }
  // 한 단 위/아래로 밀린 답. 무작위 숫자보다 훨씬 헷갈린다.
  const shift = choose(rng, [-a, a, -b, b]);
  const wrong = answer + shift;
  return card({
    text: `${a} × ${b} = ${wrong}`,
    isTrue: false,
    explain: `${a} × ${b} = ${answer} 입니다. ${wrong}은(는) 한 칸 밀린 곱셈 값이에요.`,
    tag: "mul-table",
  });
}

function mulTwoByOne(rng, wantBomb) {
  // 일의 자리 곱에서 받아올림이 반드시 생기도록 조합을 고른다.
  let a = 23;
  let b = 4;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    a = randomInt(rng, 13, 49);
    b = randomInt(rng, 3, 9);
    if ((a % 10) * b >= 10) break;
  }
  const answer = a * b;
  if (!wantBomb) {
    return card({
      text: `${a} × ${b} = ${answer}`,
      isTrue: true,
      explain: `${a} × ${b} = ${answer}, 바르게 계산했어요.`,
      tag: "mul-2x1",
    });
  }
  // 일의 자리 곱에서 생긴 받아올림을 십의 자리에 더하지 않는 실수.
  const carry = Math.floor(((a % 10) * b) / 10);
  return card({
    text: `${a} × ${b} = ${answer - carry * 10}`,
    isTrue: false,
    explain: `바른 답은 ${answer} 입니다. 일의 자리를 곱할 때 나온 받아올림 ${carry}을(를) 십의 자리에 더하지 않았어요.`,
    tag: "mul-2x1",
  });
}

function mulTwoByTwo(rng, wantBomb) {
  const a = randomInt(rng, 12, 48);
  const b = randomInt(rng, 12, 39);
  const answer = a * b;
  if (!wantBomb) {
    return card({
      text: `${a} × ${b} = ${answer}`,
      isTrue: true,
      explain: `${a} × ${b} = ${answer}, 바르게 계산했어요.`,
      tag: "mul-2x2",
    });
  }
  // 둘째 부분곱을 한 자리 왼쪽으로 밀지 않고 그대로 더하는 대표적 오류.
  const wrong = a * (b % 10) + a * Math.floor(b / 10);
  return card({
    text: `${a} × ${b} = ${wrong}`,
    isTrue: false,
    explain: `바른 답은 ${answer} 입니다. 십의 자리를 곱한 값 ${a * Math.floor(b / 10)}은(는) 한 자리 왼쪽으로 밀어서 ${a * Math.floor(b / 10) * 10}으로 더해야 해요.`,
    tag: "mul-2x2",
  });
}

function mulDecimal(rng, wantBomb) {
  const a = randomInt(rng, 2, 9); // 0.2 ~ 0.9
  const b = randomInt(rng, 2, 9);
  const product = a * b; // 소수 둘째 자리
  const left = `${toDecimal(a, 1)} × ${toDecimal(b, 1)}`;
  if (!wantBomb) {
    return card({
      text: `${left} = ${toDecimal(product, 2)}`,
      isTrue: true,
      explain: `${left} = ${toDecimal(product, 2)}, 소수점 자리를 바르게 찍었어요.`,
      tag: "decimal-mul",
    });
  }
  // 소수점을 한 자리만 옮기는 실수.
  return card({
    text: `${left} = ${toDecimal(product, 1)}`,
    isTrue: false,
    explain: `바른 답은 ${toDecimal(product, 2)} 입니다. 소수 한 자리끼리 곱하면 소수 두 자리가 돼요.`,
    tag: "decimal-mul",
  });
}

/* ── 나눗셈 ───────────────────────────────────────────── */

function divExact(rng, wantBomb) {
  const divisor = randomInt(rng, 3, 9);
  const quotient = randomInt(rng, 12, 40);
  const dividend = divisor * quotient;
  if (!wantBomb) {
    return card({
      text: `${dividend} ÷ ${divisor} = ${quotient}`,
      isTrue: true,
      explain: `${divisor} × ${quotient} = ${dividend} 이므로 맞아요.`,
      tag: "div-exact",
    });
  }
  const wrong = quotient + choose(rng, [-10, 10, -1, 1]);
  return card({
    text: `${dividend} ÷ ${divisor} = ${wrong}`,
    isTrue: false,
    explain: `바른 답은 ${quotient} 입니다. ${divisor} × ${wrong} = ${divisor * wrong} 이라서 ${dividend}이(가) 안 돼요.`,
    tag: "div-exact",
  });
}

function divRemainder(rng, wantBomb) {
  const divisor = randomInt(rng, 3, 9);
  const quotient = randomInt(rng, 4, 19);
  const remainder = randomInt(rng, 1, divisor - 1);
  const dividend = divisor * quotient + remainder;
  if (!wantBomb) {
    return card({
      text: `${dividend} ÷ ${divisor} = ${quotient}···${remainder}`,
      isTrue: true,
      explain: `${divisor} × ${quotient} + ${remainder} = ${dividend} 이므로 맞아요.`,
      tag: "div-remainder",
    });
  }
  // 나머지를 아예 빠뜨리는 실수.
  return card({
    text: `${dividend} ÷ ${divisor} = ${quotient}`,
    isTrue: false,
    explain: `바른 답은 ${quotient}···${remainder} 입니다. 나머지 ${remainder}을(를) 빠뜨렸어요.`,
    tag: "div-remainder",
  });
}

function divThreeByTwo(rng, wantBomb) {
  const divisor = randomInt(rng, 12, 34);
  const quotient = randomInt(rng, 6, 29);
  const remainder = randomInt(rng, 0, divisor - 1);
  const dividend = divisor * quotient + remainder;
  const answer = remainder === 0 ? `${quotient}` : `${quotient}···${remainder}`;
  if (!wantBomb) {
    return card({
      text: `${dividend} ÷ ${divisor} = ${answer}`,
      isTrue: true,
      explain: `${divisor} × ${quotient}${remainder ? ` + ${remainder}` : ""} = ${dividend} 이므로 맞아요.`,
      tag: "div-3x2",
    });
  }
  // 몫을 1 크게 어림해서 나머지가 나눗수보다 커지는 실수.
  const wrong = quotient - 1;
  const wrongRemainder = dividend - divisor * wrong;
  return card({
    text: `${dividend} ÷ ${divisor} = ${wrong}···${wrongRemainder}`,
    isTrue: false,
    explain: `바른 답은 ${answer} 입니다. 나머지 ${wrongRemainder}은(는) 나눗수 ${divisor}보다 크므로 몫을 1 더 키워야 해요.`,
    tag: "div-3x2",
  });
}

/* ── 학년군 매핑 ──────────────────────────────────────── */

const BUILDERS = {
  g12: {
    add: [addSmall],
    sub: [subSmall],
    mul: [mulTable],
    div: [],
  },
  g34: {
    add: [addLarge, addSmall],
    sub: [subLarge, subSmall],
    mul: [mulTwoByOne, mulTable],
    div: [divExact, divRemainder],
  },
  g56: {
    add: [addFraction, addDecimal, addLarge],
    sub: [subFraction, subLarge],
    mul: [mulTwoByTwo, mulDecimal],
    div: [divThreeByTwo, divRemainder],
  },
};

export function availableOperations(gradeBand) {
  return OPERATIONS_BY_BAND[gradeBand] || OPERATIONS_BY_BAND.g34;
}

/**
 * 연산 카드 덱을 만든다.
 * count 장 중 bombCount 장이 오답이 되도록 보장한 뒤 섞어서 돌려준다.
 */
export function generateArithmetic({
  gradeBand = "g34",
  operations = OPERATIONS,
  count = 40,
  bombCount = 12,
  rng = Math.random,
} = {}) {
  const band = BUILDERS[gradeBand] ? gradeBand : "g34";
  const allowed = operations.filter((op) => (BUILDERS[band][op] || []).length > 0);
  const usable = allowed.length ? allowed : availableOperations(band);

  const items = [];
  const seen = new Set();
  const total = Math.max(1, count);
  const bombs = Math.min(Math.max(0, bombCount), total);

  // 같은 식이 한 덱에 두 번 나오면 게임이 싱거워지므로 중복을 걸러낸다.
  const build = (wantBomb) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const operation = choose(rng, usable);
      const builder = choose(rng, BUILDERS[band][operation]);
      const item = builder(rng, wantBomb);
      const key = item.text.split("=")[0].trim();
      if (seen.has(key)) continue;
      seen.add(key);
      return item;
    }
    // 후보가 고갈되면 중복을 허용해서라도 덱 크기를 채운다.
    const operation = choose(rng, usable);
    return choose(rng, BUILDERS[band][operation])(rng, wantBomb);
  };

  for (let index = 0; index < bombs; index += 1) items.push(build(true));
  for (let index = bombs; index < total; index += 1) items.push(build(false));

  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}
