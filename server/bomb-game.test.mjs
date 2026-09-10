import test from "node:test";
import assert from "node:assert/strict";
import {
  BombRoom,
  TeacherHub,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MAX_HUB_ROOMS,
  normalizeConfig,
  normalizeCustomItems,
  buildDeck,
  TURN_TIMEOUT_MS,
} from "./bomb-game.mjs";

/* ── 테스트 도우미 ────────────────────────────────────── */

const items = (count) =>
  Array.from({ length: count }, (_, index) => ({
    text: `문항${index}`,
    isTrue: index % 3 !== 0,
    explain: `해설${index}`,
  }));

function makeRoom(config = {}, playerCount = 2) {
  const room = new BombRoom("S001", {
    questionType: "custom",
    customItems: items(40),
    ...config,
  });
  const names = ["가람", "나은", "다올", "라온"];
  for (let index = 0; index < playerCount; index += 1)
    room.addPlayer({ id: `p${index + 1}`, name: names[index] });
  return room;
}

/** 격자를 원하는 참·거짓 배치로 고정해서 무작위성을 없앤다. */
function stackGrid(room, flags) {
  room.grid = flags.map((isTrue, index) => ({
    card: {
      id: `fixed${index}`,
      text: `고정카드${index}`,
      isTrue,
      explain: `고정해설${index}`,
      tag: "fixed",
    },
  }));
}

/**
 * 공개·턴종료 타이머만 정확히 흘려보낸다.
 * 먼 미래 시각으로 tick하면 턴 제한 시간까지 같이 만료되어
 * 검사하려던 턴을 지나쳐 버리므로 대기 중인 타이머 시각만 넘긴다.
 */
const settle = (room) => {
  for (let guard = 0; guard < 50; guard += 1) {
    const pendingAt = room.revealEndsAt ?? room.turnEndEndsAt;
    if (!pendingAt) break;
    if (!room.tick(pendingAt + 1)) break;
  }
};

/* ── 참가자 ───────────────────────────────────────────── */

test("한 방은 2~4명까지만 들어갈 수 있다", () => {
  const room = makeRoom({}, 4);
  assert.equal(room.connectedPlayers().length, MAX_PLAYERS);
  const overflow = room.addPlayer({ id: "p5", name: "마루" });
  assert.equal(overflow.ok, false);
});

test("혼자서는 시작할 수 없다", () => {
  const room = makeRoom({}, 1);
  const result = room.start();
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(`${MIN_PLAYERS}명`));
});

test("같은 이름으로는 들어갈 수 없다", () => {
  const room = makeRoom({}, 2);
  assert.equal(room.addPlayer({ id: "px", name: "가람" }).ok, false);
});

test("게임이 시작되면 새로 들어올 수 없다", () => {
  const room = makeRoom({}, 2);
  room.start();
  assert.equal(room.addPlayer({ id: "p3", name: "다올" }).ok, false);
});

test("끊겼다가 돌아오면 점수를 그대로 이어받는다", () => {
  const room = makeRoom({}, 2);
  room.start();
  room.getPlayer("p1").score = 7;
  room.setConnected("p1", false);
  assert.equal(room.reconnectPlayer("p1", "가람").ok, true);
  assert.equal(room.getPlayer("p1").score, 7);
  assert.equal(room.getPlayer("p1").connected, true);
});

/* ── 모둠 1기기 모드 ──────────────────────────────────── */

test("한 기기로 여러 명이 함께 들어올 수 있다", () => {
  const room = new BombRoom("SD01", { questionType: "custom", customItems: items(40) });
  const result = room.addPlayers(["가람", "나은", "다올"]);
  assert.equal(result.ok, true);
  assert.equal(room.players.size, 3);
  // 셋이 같은 기기를 쓰므로 주인이 같아야 한다.
  const owners = new Set([...room.players.values()].map((player) => player.ownerId));
  assert.equal(owners.size, 1);
  assert.equal(result.primary.name, "가람");
});

test("같은 기기의 친구 차례도 그 기기가 조작한다", () => {
  const room = new BombRoom("SD03", { questionType: "custom", customItems: items(40) });
  const added = room.addPlayers(["가람", "나은"]);
  const [first, second] = added.players;
  room.start();

  assert.equal(room.currentPlayerId(), first.id);
  // 대표가 아닌 두 번째 참가자 이름으로도 첫 번째 차례를 조작할 수 있어야 한다.
  assert.equal(room.rollDice(second.id).ok, true);

  room.endTurn(false);
  settle(room);
  assert.equal(room.currentPlayerId(), second.id);
  // 이제 두 번째 차례인데 대표가 대신 굴려도 된다. (기기를 넘겨받아 조작)
  assert.equal(room.rollDice(first.id).ok, true);
});

test("다른 기기의 차례는 조작할 수 없다", () => {
  const room = new BombRoom("SD04", { questionType: "custom", customItems: items(40) });
  const shared = room.addPlayers(["가람", "나은"]).players;
  const solo = room.addPlayer({ id: "solo", name: "다올" }).player;
  room.start();

  assert.equal(room.currentPlayerId(), shared[0].id);
  assert.equal(room.rollDice(solo.id).ok, false, "다른 기기가 남의 차례를 조작했습니다.");
  assert.equal(room.controls(solo.id, shared[0].id), false);
  assert.equal(room.controls(shared[1].id, shared[0].id), true);
});

test("기기가 끊기면 그 기기의 참가자가 다 같이 끊긴다", () => {
  const room = new BombRoom("SD05", { questionType: "custom", customItems: items(40) });
  const shared = room.addPlayers(["가람", "나은"]).players;
  room.addPlayer({ id: "solo", name: "다올" });

  room.setConnected(shared[0].id, false);
  assert.equal(room.getPlayer(shared[0].id).connected, false);
  assert.equal(room.getPlayer(shared[1].id).connected, false, "같은 기기인데 혼자만 끊겼습니다.");
  assert.equal(room.getPlayer("solo").connected, true, "다른 기기까지 끊겼습니다.");

  room.reconnectPlayer(shared[0].id, "가람");
  assert.equal(room.getPlayer(shared[1].id).connected, true, "같이 돌아오지 않았습니다.");
});

test("같은 이름을 두 번 적거나 정원을 넘으면 아무도 안 들어간다", () => {
  const room = new BombRoom("SD06", { questionType: "custom", customItems: items(40) });
  assert.equal(room.addPlayers(["가람", "가람"]).ok, false);
  assert.equal(room.players.size, 0, "실패했는데 일부가 들어갔습니다.");

  assert.equal(room.addPlayers(["가", "나", "다", "라", "마"]).ok, false);
  assert.equal(room.players.size, 0);

  room.addPlayer({ id: "solo", name: "가람" });
  assert.equal(room.addPlayers(["가람", "나은"]).ok, false, "이름이 겹치는데 들어갔습니다.");
  assert.equal(room.players.size, 1);
});

test("한 기기로 들어오면 화면에 그렇게 알려 준다", () => {
  const room = new BombRoom("SD07", { questionType: "custom", customItems: items(40) });
  const shared = room.addPlayers(["가람", "나은"]).players;
  room.start();

  const snapshot = room.snapshotFor(shared[1].id);
  assert.equal(snapshot.sharedDevice, true);
  // 지금은 가람 차례지만 나은의 기기가 곧 그 기기다.
  assert.equal(snapshot.currentPlayerName, "가람");
  assert.equal(snapshot.isMyTurn, true);
  const mates = snapshot.players.filter((player) => player.sameDevice);
  assert.equal(mates.length, 2);

  const solo = new BombRoom("SD08", { questionType: "custom", customItems: items(40) });
  solo.addPlayer({ id: "p1", name: "가람" });
  solo.addPlayer({ id: "p2", name: "나은" });
  solo.start();
  assert.equal(solo.snapshotFor("p1").sharedDevice, false);
  assert.equal(solo.snapshotFor("p2").isMyTurn, false);
});

/* ── 정답 유출 방지 ───────────────────────────────────── */

test("뒷면 카드의 내용은 스냅샷에 절대 담기지 않는다", () => {
  const room = makeRoom({}, 2);
  room.start();
  const snapshot = JSON.stringify(room.snapshotFor("p1"));
  // 더미와 격자에 있는 모든 카드 문장이 새어 나가면 안 된다.
  for (const card of [...room.deck, ...room.grid.filter(Boolean).map((slot) => slot.card)]) {
    assert.ok(
      !snapshot.includes(card.text),
      `뒷면 카드 "${card.text}" 의 내용이 클라이언트로 전송됩니다.`,
    );
  }
  for (const slot of room.snapshotFor("p1").grid) {
    assert.equal(slot.faceUp, false);
    assert.equal(slot.text, undefined);
  }
});

test("판정하기 전에는 정답 여부를 알려 주지 않는다", () => {
  const room = makeRoom({ judgeMode: true }, 2);
  room.start();
  stackGrid(room, [true, false, true, true, false, true, true, true, false]);
  room.rollDice("p1");
  room.pickCard("p1", 0);

  assert.equal(room.phase, "judge");
  const slot = room.snapshotFor("p1").grid[0];
  assert.equal(slot.faceUp, true);
  assert.equal(slot.text, "고정카드0"); // 문장은 읽어야 하니 보인다
  assert.equal(slot.isTrue, null); // 하지만 답은 아직 숨긴다
  assert.equal(slot.explain, null);
});

test("공개 단계가 되면 정답과 해설을 보여 준다", () => {
  const room = makeRoom({ judgeMode: true }, 2);
  room.start();
  stackGrid(room, [false, true, true, true, true, true, true, true, true]);
  room.rollDice("p1");
  room.pickCard("p1", 0);
  room.judge("p1", "X");

  const slot = room.snapshotFor("p1").grid[0];
  assert.equal(room.phase, "reveal");
  assert.equal(slot.isTrue, false);
  assert.equal(slot.explain, "고정해설0");
  assert.equal(slot.safe, true); // 폭탄을 폭탄이라고 맞혔으므로 안전
});

/* ── 판정 모드 ────────────────────────────────────────── */

test("판정 모드: 바르게 판정하면 살아남고 틀리면 폭탄이 터진다", () => {
  const room = makeRoom({ judgeMode: true, diceMax: 3 }, 2);
  room.start();
  stackGrid(room, [true, false, true, true, true, true, true, true, true]);

  room.rollDice("p1");
  room.dice = 2;
  room.streakTarget = 2;

  room.pickCard("p1", 0); // 참인 카드
  room.judge("p1", "O"); // 바른 판정
  assert.equal(room.streak, 1);
  settle(room);

  assert.equal(room.phase, "pick");
  room.pickCard("p1", 1); // 거짓인 카드
  room.judge("p1", "O"); // 틀린 판정 → 폭탄
  assert.equal(room.pending.safe, false);
  settle(room);

  assert.equal(room.turnResult.success, false);
  assert.equal(room.getPlayer("p1").score, 0);
});

test("판정 모드: 참인 카드를 폭탄이라고 하면 터진다", () => {
  const room = makeRoom({ judgeMode: true }, 2);
  room.start();
  stackGrid(room, Array(9).fill(true));
  room.rollDice("p1");
  room.pickCard("p1", 0);
  room.judge("p1", "X"); // 참인데 폭탄이라고 판정
  assert.equal(room.pending.safe, false);
});

test("원본 모드에서는 판정 단계 없이 카드 자체로 결정된다", () => {
  const room = makeRoom({ judgeMode: false }, 2);
  room.start();
  stackGrid(room, [false, true, true, true, true, true, true, true, true]);
  room.rollDice("p1");
  room.pickCard("p1", 0); // 폭탄 카드
  assert.equal(room.phase, "reveal"); // judge 단계를 건너뛴다
  assert.equal(room.pending.safe, false);
});

/* ── 점수 ─────────────────────────────────────────────── */

test("주사위 숫자만큼 연속으로 성공하면 그 숫자만큼 점수를 얻는다", () => {
  const room = makeRoom({ judgeMode: true }, 2);
  room.start();
  stackGrid(room, Array(9).fill(true));
  room.rollDice("p1");
  room.dice = 3;
  room.streakTarget = 3;

  for (let index = 0; index < 3; index += 1) {
    room.pickCard("p1", index);
    room.judge("p1", "O");
    settle(room);
  }
  assert.equal(room.turnResult.success, true);
  assert.equal(room.getPlayer("p1").score, 3);
});

test("중간에 터지면 기본 점수제에서는 0점이다", () => {
  const room = makeRoom({ judgeMode: true, scoring: "allOrNothing" }, 2);
  room.start();
  stackGrid(room, [true, true, false, true, true, true, true, true, true]);
  room.rollDice("p1");
  room.dice = 3;
  room.streakTarget = 3;

  room.pickCard("p1", 0);
  room.judge("p1", "O");
  settle(room);
  room.pickCard("p1", 1);
  room.judge("p1", "O");
  settle(room);
  room.pickCard("p1", 2);
  room.judge("p1", "O"); // 폭탄인데 참이라고 판정
  settle(room);

  assert.equal(room.turnResult.success, false);
  assert.equal(room.turnResult.cleared, 2);
  assert.equal(room.getPlayer("p1").score, 0);
});

test("부분 점수제에서는 터져도 넘긴 만큼 점수를 준다", () => {
  const room = makeRoom({ judgeMode: true, scoring: "partial" }, 2);
  room.start();
  stackGrid(room, [true, true, false, true, true, true, true, true, true]);
  room.rollDice("p1");
  room.dice = 3;
  room.streakTarget = 3;

  room.pickCard("p1", 0);
  room.judge("p1", "O");
  settle(room);
  room.pickCard("p1", 1);
  room.judge("p1", "O");
  settle(room);
  room.pickCard("p1", 2);
  room.judge("p1", "O");
  settle(room);

  assert.equal(room.getPlayer("p1").score, 2);
});

/* ── 턴 진행 ──────────────────────────────────────────── */

test("턴이 끝나면 다음 사람에게 넘어간다", () => {
  const room = makeRoom({ judgeMode: true }, 3);
  room.start();
  assert.equal(room.currentPlayerId(), "p1");
  room.endTurn(false);
  settle(room);
  assert.equal(room.currentPlayerId(), "p2");
  assert.equal(room.phase, "roll");
});

test("접속이 끊긴 사람의 턴은 건너뛴다", () => {
  const room = makeRoom({ judgeMode: true }, 3);
  room.start();
  room.setConnected("p2", false);
  room.endTurn(false);
  settle(room);
  assert.equal(room.currentPlayerId(), "p3");
});

test("자기 차례가 아니면 아무것도 할 수 없다", () => {
  const room = makeRoom({}, 2);
  room.start();
  assert.equal(room.rollDice("p2").ok, false);
  room.rollDice("p1");
  assert.equal(room.pickCard("p2", 0).ok, false);
});

test("한 바퀴 돌면 라운드가 올라간다", () => {
  const room = makeRoom({}, 2);
  room.start();
  assert.equal(room.round, 1);
  room.endTurn(false);
  settle(room);
  assert.equal(room.round, 1); // p1 → p2
  room.endTurn(false);
  settle(room);
  assert.equal(room.round, 2); // p2 → p1, 한 바퀴 완료
});

test("제한 시간을 넘기면 자동으로 턴이 넘어간다", () => {
  const room = makeRoom({}, 2);
  room.start();
  assert.equal(room.phase, "roll");
  room.tick(Date.now() + TURN_TIMEOUT_MS + 1_000);
  assert.equal(room.phase, "turnEnd");
  assert.equal(room.turnResult.success, false);
});

test("끊긴 사람의 턴은 제한 시간이 짧아진다", () => {
  const room = makeRoom({}, 2);
  room.start();
  const before = room.turnDeadline;
  room.setConnected("p1", false);
  assert.ok(room.turnDeadline < before, "끊긴 사람의 대기 시간이 줄지 않았습니다.");
});

/* ── 격자와 덱 ────────────────────────────────────────── */

test("카드를 쓰면 더미에서 바로 새 카드로 채운다", () => {
  const room = makeRoom({ judgeMode: false }, 2);
  room.start();
  const deckBefore = room.deck.length;
  const filled = room.grid.filter(Boolean).length;
  room.rollDice("p1");
  room.pickCard("p1", 0);
  settle(room);
  assert.equal(room.grid.filter(Boolean).length, filled, "격자에 빈자리가 생겼습니다.");
  assert.equal(room.deck.length, deckBefore - 1);
});

test("남은 카드가 주사위 숫자보다 적으면 목표를 남은 수로 낮춘다", () => {
  const room = makeRoom({}, 2);
  room.start();
  room.deck = [];
  stackGrid(room, [true, true]);
  room.config.diceMax = 6;
  room.rollDice("p1");
  assert.ok(room.streakTarget <= 2, `목표가 ${room.streakTarget}장으로 잡혔습니다.`);
});

test("카드가 다 떨어지면 게임이 끝나고 순위가 나온다", () => {
  const room = makeRoom({}, 2);
  room.start();
  room.deck = [];
  room.grid = room.grid.map(() => null);
  room.getPlayer("p1").score = 5;
  room.getPlayer("p2").score = 3;
  room.endTurn(false);
  settle(room);

  assert.equal(room.phase, "finished");
  assert.equal(room.result.reason, "deckEmpty");
  assert.deepEqual(
    room.result.ranking.map((entry) => entry.name),
    ["가람", "나은"],
  );
  assert.deepEqual(room.result.winners, ["가람"]);
});

test("목표 점수에 닿으면 게임이 끝난다", () => {
  const room = makeRoom({ targetScore: 5 }, 2);
  room.start();
  room.getPlayer("p1").score = 6;
  room.endTurn(true);
  settle(room);
  assert.equal(room.phase, "finished");
  assert.equal(room.result.reason, "target");
});

test("결과에는 이번 판에 터진 폭탄이 모두 담긴다", () => {
  const room = makeRoom({ judgeMode: true }, 2);
  room.start();
  stackGrid(room, [false, true, true, true, true, true, true, true, true]);
  room.rollDice("p1");
  room.pickCard("p1", 0);
  room.judge("p1", "O"); // 오답 판정 → 기록에 남는다
  settle(room);
  room.finish("stopped");
  assert.equal(room.result.bombs.length, 1);
  assert.equal(room.result.bombs[0].explain, "고정해설0");
});

/* ── 설정 ─────────────────────────────────────────────── */

test("게임 중에는 설정을 바꿀 수 없다", () => {
  const room = makeRoom({}, 2);
  room.start();
  assert.equal(room.updateSettings({ diceMax: 6 }).ok, false);
});

test("설정을 바꿔도 올려 둔 엑셀 문제는 남아 있다", () => {
  const room = makeRoom({}, 2);
  room.setQuestions(items(20));
  assert.equal(room.config.customItems.length, 20);
  room.updateSettings({ diceMax: 6, gridSize: 16 });
  assert.equal(room.config.customItems.length, 20);
  assert.equal(room.config.diceMax, 6);
});

test("1~2학년을 고르면 나눗셈은 자동으로 빠진다", () => {
  const config = normalizeConfig({ gradeBand: "g12", operations: ["add", "div"] });
  assert.deepEqual(config.operations, ["add"]);
});

test("이상한 설정값은 안전한 범위로 잘린다", () => {
  const config = normalizeConfig({
    diceMax: 99,
    gridSize: 7,
    deckSize: 9999,
    bombRatio: 5,
    targetScore: -3,
    questionType: "해킹",
  });
  assert.equal(config.diceMax, 4);
  assert.equal(config.gridSize, 9);
  assert.equal(config.deckSize, 60);
  assert.equal(config.bombRatio, 0.5);
  assert.equal(config.targetScore, 0);
  assert.equal(config.questionType, "arithmetic");
});

test("엑셀 문제는 개수와 길이가 제한되고 중복은 걸러진다", () => {
  const rows = [
    { text: "같은 문장", isTrue: true },
    { text: "같은 문장", isTrue: false },
    { text: "  ", isTrue: true },
    { text: "x".repeat(500), isTrue: true },
    ...items(500),
  ];
  const normalized = normalizeCustomItems(rows);
  assert.ok(normalized.length <= 200);
  assert.equal(normalized.filter((item) => item.text === "같은 문장").length, 1);
  assert.ok(normalized.every((item) => item.text.length <= 160));
  assert.ok(normalized.every((item) => item.text.trim().length > 0));
});

test("문제가 너무 적으면 시작을 막는다", () => {
  const room = new BombRoom("S002", { questionType: "custom", customItems: items(10) });
  room.addPlayer({ id: "p1", name: "가람" });
  room.addPlayer({ id: "p2", name: "나은" });
  const result = room.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /필요/);
});

test("문제가 모자란 설정은 시작 전에 미리 알 수 있다", () => {
  // 수업 중 "시작"을 눌러서야 알게 되면 곤란하므로 설정 단계에서 판단할 수 있어야 한다.
  // 내장 문제은행은 계속 늘어나므로, 부족 상황은 엑셀 문제 수로 만들어 검사한다.
  const thin = new BombRoom("S003", {
    questionType: "custom",
    customItems: items(10),
    gridSize: 9,
  });
  const config = thin.settingsConfig();
  assert.equal(config.availableQuestions, 10);
  assert.equal(config.requiredQuestions, 12);

  thin.addPlayer({ id: "p1", name: "가람" });
  thin.addPlayer({ id: "p2", name: "나은" });
  assert.equal(thin.start().ok, false, "문제가 모자란데 시작되었습니다.");

  // 4×4는 19장이 필요하므로 3×3으로는 되던 것도 막혀야 한다.
  const wide = new BombRoom("S004", {
    questionType: "custom",
    customItems: items(15),
    gridSize: 16,
  });
  assert.equal(wide.settingsConfig().requiredQuestions, 19);
  wide.addPlayer({ id: "p1", name: "가람" });
  wide.addPlayer({ id: "p2", name: "나은" });
  assert.equal(wide.start().ok, false);

  // 연산은 무한히 만들 수 있으므로 -1(제한 없음)로 알린다.
  const endless = new BombRoom("S005", { questionType: "arithmetic", gradeBand: "g34" });
  assert.equal(endless.settingsConfig().availableQuestions, -1);
});

test("내장 문제은행은 모든 조합에서 4×4까지 시작할 수 있다", () => {
  // 선생님이 어떤 과목·학년군을 골라도 수업 중에 막히면 안 된다.
  const subjects = ["math", "science", "social", "korean", "english"];
  const bands = ["g12", "g34", "g56"];
  const combos = [
    ...bands.map((gradeBand) => ({ questionType: "spelling", gradeBand })),
    ...subjects.flatMap((subject) =>
      bands.map((gradeBand) => ({ questionType: "proposition", subject, gradeBand })),
    ),
  ];

  for (const combo of combos) {
    for (const gridSize of [9, 16]) {
      const room = new BombRoom("S006", { ...combo, gridSize });
      const config = room.settingsConfig();
      assert.ok(
        config.availableQuestions >= config.requiredQuestions,
        `${JSON.stringify(combo)} ${gridSize}칸: ${config.availableQuestions}장뿐 (${config.requiredQuestions}장 필요)`,
      );
      room.addPlayer({ id: "p1", name: "가람" });
      room.addPlayer({ id: "p2", name: "나은" });
      assert.equal(
        room.start().ok,
        true,
        `${JSON.stringify(combo)} ${gridSize}칸에서 시작하지 못했습니다.`,
      );
    }
  }
});

test("덱은 요청한 폭탄 비율을 지킨다", () => {
  const config = normalizeConfig({ questionType: "arithmetic", deckSize: 40, bombRatio: 0.3 });
  const deck = buildDeck(config);
  assert.equal(deck.length, 40);
  assert.equal(deck.filter((card) => !card.isTrue).length, 12);
});

/* ── 알 수 없는 요청 ──────────────────────────────────── */

test("모르는 메시지는 조용히 거절한다", () => {
  const room = makeRoom({}, 2);
  assert.equal(room.handle("p1", { type: "drop_table" }).ok, false);
});

test("방장이 아니면 시작·설정·문제 올리기를 할 수 없다", () => {
  const room = makeRoom({}, 2);
  assert.equal(room.handle("p2", { type: "start" }).ok, false);
  assert.equal(room.handle("p2", { type: "update_settings", config: {} }).ok, false);
  assert.equal(room.handle("p2", { type: "set_questions", items: items(20) }).ok, false);
});

/* ── 담임 통합방 ──────────────────────────────────────── */

test("통합방은 7개까지만 만들 수 있다", () => {
  const hub = new TeacherHub("T001", "teacher", "문수쌤", 99);
  assert.equal(hub.rooms.size, MAX_HUB_ROOMS);
  assert.equal(hub.createChildRoom({}, "8모둠").ok, false);
});

test("통합방을 만들면 모둠 이름이 자동으로 붙는다", () => {
  const hub = new TeacherHub("T001", "teacher", "문수쌤", 3);
  assert.deepEqual(
    [...hub.rooms.values()].map((room) => room.label),
    ["1모둠", "2모둠", "3모둠"],
  );
});

test("선생님은 모든 방의 방장 권한을 가진다", () => {
  const hub = new TeacherHub("T001", "teacher", "문수쌤", 1);
  const room = [...hub.rooms.values()][0];
  room.addPlayer({ id: "p1", name: "가람" });
  assert.equal(room.canHost("teacher"), true);
});

test("설정을 모든 방에 한 번에 적용할 수 있다", () => {
  const hub = new TeacherHub("T001", "teacher", "문수쌤", 5);
  const result = hub.applyToAll({ gradeBand: "g56", questionType: "spelling", diceMax: 6 });
  assert.equal(result.ok, true);
  for (const room of hub.rooms.values()) {
    assert.equal(room.config.gradeBand, "g56");
    assert.equal(room.config.diceMax, 6);
  }
});

test("인원이 모인 방만 일괄 시작된다", () => {
  const hub = new TeacherHub("T001", "teacher", "문수쌤", 2);
  const [ready, empty] = [...hub.rooms.values()];
  hub.applyToAll({ questionType: "arithmetic", gradeBand: "g34" });
  ready.addPlayer({ id: "p1", name: "가람" });
  ready.addPlayer({ id: "p2", name: "나은" });

  const result = hub.startAll();
  assert.deepEqual(result.started, ["1모둠"]);
  assert.equal(result.failures.length, 1);
  assert.equal(empty.phase, "lobby");
});

test("방은 최소 하나는 남아 있어야 한다", () => {
  const hub = new TeacherHub("T001", "teacher", "문수쌤", 1);
  assert.equal(hub.removeChildRoom([...hub.rooms.keys()][0]).ok, false);
});

test("어느 문제에서 많이 터졌는지 모아 준다", () => {
  const hub = new TeacherHub("T001", "teacher", "문수쌤", 2);
  const rooms = [...hub.rooms.values()];
  for (const room of rooms) {
    room.log.push({ text: "7 × 8 = 48", explain: "56입니다", isTrue: false, tag: "mul", safe: false });
  }
  rooms[0].log.push({ text: "1 + 1 = 3", explain: "2입니다", isTrue: false, tag: "add", safe: false });
  rooms[0].log.push({ text: "안전한 카드", explain: "", isTrue: true, tag: "add", safe: true });

  const heatmap = hub.bombHeatmap();
  assert.equal(heatmap[0].text, "7 × 8 = 48");
  assert.equal(heatmap[0].count, 2);
  assert.ok(!heatmap.some((entry) => entry.text === "안전한 카드"));
});

test("교사 요약에는 방마다 진행 상황이 담긴다", () => {
  const room = makeRoom({}, 2);
  room.label = "3모둠";
  room.start();
  const summary = room.summary();
  assert.equal(summary.label, "3모둠");
  assert.equal(summary.connectedCount, 2);
  assert.equal(summary.phase, "roll");
  assert.equal(summary.currentPlayerName, "가람");
  assert.ok(summary.cardsRemaining > 0);
});
