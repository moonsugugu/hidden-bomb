import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocket } from "ws";

// 실제 WebSocket 서버를 띄워 선생님 → 학생 흐름을 끝까지 확인한다.
// 게임 규칙 자체는 bomb-game.test.mjs가 맡고, 여기서는 프로토콜과 배선을 본다.

const PORT = 3299;
const BASE = `ws://127.0.0.1:${PORT}/v1/game?game=hidden-bomb`;
const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs");

let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("서버가 시간 안에 뜨지 않았습니다.")), 10_000);
    serverProcess.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("/v1/game")) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
    serverProcess.on("error", reject);
  });
}

function client(params = {}) {
  const url = new URL(BASE);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) url.searchParams.set(key, String(value));
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (waiters[index].predicate(message)) {
        waiters[index].resolve(message);
        waiters.splice(index, 1);
      }
    }
  });

  return {
    socket,
    messages,
    send: (payload) => socket.send(JSON.stringify(payload)),
    opened: () =>
      new Promise((resolve) =>
        socket.readyState === WebSocket.OPEN ? resolve() : socket.once("open", resolve),
      ),
    wait(predicate, label = "메시지", timeout = 5_000) {
      const seen = messages.find(predicate);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${label} 를 기다리다 시간이 지났습니다.`)),
          timeout,
        );
        waiters.push({
          predicate,
          resolve: (message) => {
            clearTimeout(timer);
            resolve(message);
          },
        });
      });
    },
    close: () => socket.close(),
  };
}

const isState = (predicate) => (message) => message.type === "state" && predicate(message);

test.before(startServer);
test.after(() => serverProcess?.kill());

test("선생님이 통합방을 만들면 모둠 방 7개가 생긴다", async () => {
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 7 });

  const created = await teacher.wait((m) => m.type === "hub_created", "hub_created");
  assert.ok(created.hub.startsWith("T"));

  const state = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  assert.equal(state.rooms.length, 7);
  assert.equal(state.hub.maxRooms, 7);
  assert.deepEqual(
    state.rooms.map((room) => room.label),
    ["1모둠", "2모둠", "3모둠", "4모둠", "5모둠", "6모둠", "7모둠"],
  );
  teacher.close();
});

test("학생이 방 코드로 들어가고 선생님 화면에 바로 보인다", async () => {
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 2 });
  const hubState = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  const roomCode = hubState.rooms[0].code;

  const student = client({ room: roomCode, name: "가람" });
  await student.opened();
  const connected = await student.wait(
    (m) => m.type === "connected" && m.playerId,
    "connected",
  );
  assert.ok(connected.playerId);

  const updated = await teacher.wait(
    (m) => m.type === "hub_state" && m.rooms[0].connectedCount === 1,
    "학생 입장 반영",
  );
  assert.equal(updated.rooms[0].players[0].name, "가람");

  student.close();
  teacher.close();
});

test("주사위 → 카드 선택 → 자동 판정 흐름이 끝까지 동작한다", async () => {
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 1 });
  const hubState = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  const roomCode = hubState.rooms[0].code;

  // 실제 시간을 기다려야 하므로 테스트가 오래 걸리지 않도록 최소값(3초)으로 설정한다.
  teacher.send({
    type: "apply_all",
    config: { questionType: "arithmetic", gradeBand: "g34", judgeSeconds: 3, diceMax: 4 },
  });

  const alpha = client({ room: roomCode, name: "가람" });
  const beta = client({ room: roomCode, name: "나은" });
  await alpha.opened();
  await alpha.wait((m) => m.type === "connected" && m.playerId, "가람 입장");
  await beta.opened();
  await beta.wait((m) => m.type === "connected" && m.playerId, "나은 입장");

  teacher.send({ type: "start_all" });

  const rollState = await alpha.wait(isState((m) => m.phase === "roll"), "주사위 단계");
  assert.equal(rollState.players.length, 2);
  assert.equal(rollState.currentPlayerName, "가람");
  assert.equal(rollState.isMyTurn, true);
  assert.equal(rollState.grid.length, 9);

  // 뒷면 카드는 내용이 오면 안 된다.
  assert.ok(rollState.grid.every((slot) => slot.faceUp === false && slot.text === undefined));

  alpha.send({ type: "roll_dice" });
  const pickState = await alpha.wait(isState((m) => m.phase === "pick"), "카드 선택 단계");
  assert.ok(pickState.dice >= 1 && pickState.dice <= 4);
  assert.ok(pickState.streakTarget >= 1);

  alpha.send({ type: "pick_card", index: 0 });
  const judgeState = await alpha.wait(isState((m) => m.phase === "judge"), "판정 대기 단계");
  const openSlot = judgeState.grid[0];
  assert.equal(openSlot.faceUp, true);
  assert.ok(openSlot.text.length > 0, "문장이 비어 있습니다.");
  assert.equal(openSlot.isTrue, null, "공개 전에 정답이 노출됩니다.");
  assert.equal(judgeState.config.judgeSeconds, 3);
  assert.ok(judgeState.judgeEndsAt > Date.now(), "판정 대기 타이머가 클라이언트에 오지 않습니다.");

  // 차례가 아닌 나은도 같은 문장을 같은 순간에 본다. 사람이 누르는 버튼은 어디에도 없다.
  const betaJudgeState = await beta.wait(isState((m) => m.phase === "judge"), "나은도 함께 본다");
  assert.equal(betaJudgeState.grid[0].text, openSlot.text);
  assert.equal(betaJudgeState.isMyTurn, false);

  // 아무도 아무 버튼도 누르지 않는다. 3초 뒤 서버가 저절로 공개한다.
  const revealState = await alpha.wait(isState((m) => m.phase === "reveal"), "자동 공개", 6_000);
  assert.notEqual(revealState.grid[0].isTrue, null);
  assert.equal(typeof revealState.grid[0].safe, "boolean");
  assert.ok(revealState.grid[0].explain.length > 0);
  assert.equal(revealState.judgeEndsAt, null);

  alpha.close();
  beta.close();
  teacher.close();
});

test("예전처럼 judge 메시지를 보내도 오류로 안내될 뿐 게임이 깨지지 않는다", async () => {
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 1 });
  const hubState = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  const roomCode = hubState.rooms[0].code;

  const alpha = client({ room: roomCode, name: "가람" });
  const beta = client({ room: roomCode, name: "나은" });
  await alpha.opened();
  await alpha.wait((m) => m.type === "connected" && m.playerId, "가람 입장");
  await beta.opened();
  await beta.wait((m) => m.type === "connected" && m.playerId, "나은 입장");
  teacher.send({ type: "start_all" });
  await alpha.wait(isState((m) => m.phase === "roll"), "게임 시작");

  alpha.send({ type: "roll_dice" });
  await alpha.wait(isState((m) => m.phase === "pick"), "카드 선택 단계");
  alpha.send({ type: "pick_card", index: 0 });
  await alpha.wait(isState((m) => m.phase === "judge"), "판정 대기 단계");

  alpha.send({ type: "judge", answer: "O" });
  const error = await alpha.wait((m) => m.type === "error", "안내 메시지");
  assert.match(error.message, /자동/);

  alpha.close();
  beta.close();
  teacher.close();
});

test("자기 차례가 아닌 학생의 조작은 거절된다", async () => {
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 1 });
  const hubState = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  const roomCode = hubState.rooms[0].code;

  const alpha = client({ room: roomCode, name: "가람" });
  const beta = client({ room: roomCode, name: "나은" });
  await alpha.opened();
  await alpha.wait((m) => m.type === "connected" && m.playerId, "가람 입장");
  await beta.opened();
  await beta.wait((m) => m.type === "connected" && m.playerId, "나은 입장");
  teacher.send({ type: "start_all" });
  await beta.wait(isState((m) => m.phase === "roll"), "게임 시작");

  beta.send({ type: "roll_dice" });
  const error = await beta.wait((m) => m.type === "error", "차례 아님 오류");
  assert.match(error.message, /차례/);

  alpha.close();
  beta.close();
  teacher.close();
});

test("엑셀 200문제를 한 번에 올려도 연결이 끊기지 않는다", async () => {
  // 의심의밤의 maxPayload 4KB를 그대로 뒀다면 여기서 소켓이 닫힌다.
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 1 });
  const hubState = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  const roomCode = hubState.rooms[0].code;

  const items = Array.from({ length: 200 }, (_, index) => ({
    text: `우리 반 문제 ${index}번: 이 문장은 참일까요 거짓일까요 한번 생각해 봅시다`,
    isTrue: index % 3 !== 0,
    explain: `해설 ${index}번: 왜 그런지 자세히 설명하는 문장을 충분히 길게 적어 둡니다`,
  }));
  const payloadBytes = Buffer.byteLength(JSON.stringify(items), "utf8");
  assert.ok(payloadBytes > 4_096, `본문이 ${payloadBytes}바이트라 검증 의미가 없습니다.`);

  teacher.send({ type: "teacher_action", roomCode, action: "set_questions", items });

  const updated = await teacher.wait(
    (m) => m.type === "hub_state" && m.rooms[0].questionCount === 200,
    "문제 200개 반영",
  );
  assert.equal(updated.rooms[0].config.questionType, "custom");
  assert.equal(teacher.socket.readyState, WebSocket.OPEN, "업로드 후 연결이 끊겼습니다.");
  teacher.close();
});

test("새로고침해도 같은 참가자로 돌아온다", async () => {
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 1 });
  const hubState = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  const roomCode = hubState.rooms[0].code;

  const first = client({ room: roomCode, name: "가람" });
  await first.opened();
  const connected = await first.wait((m) => m.type === "connected" && m.playerId, "입장");
  const playerId = connected.playerId;
  first.close();

  const again = client({ room: roomCode, name: "가람", playerId });
  await again.opened();
  const back = await again.wait((m) => m.type === "connected" && m.playerId, "재입장");
  assert.equal(back.playerId, playerId, "재접속에서 다른 참가자로 붙었습니다.");

  const state = await again.wait(isState(() => true), "상태");
  assert.equal(state.players.length, 1, "새로고침했는데 참가자가 늘었습니다.");

  again.close();
  teacher.close();
});

test("태블릿 한 대로 모둠 전체가 들어와 번갈아 조작할 수 있다", async () => {
  // 학생 기기가 모둠당 한 대뿐인 교실을 위한 모드.
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 1 });
  const hubState = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  const roomCode = hubState.rooms[0].code;

  const tablet = client({ room: roomCode, names: "가람,나은,다올" });
  await tablet.opened();
  await tablet.wait((m) => m.type === "connected" && m.playerId, "태블릿 입장");

  const lobby = await tablet.wait(isState((m) => m.players.length === 3), "세 명 입장");
  assert.equal(lobby.sharedDevice, true);
  assert.ok(lobby.players.every((player) => player.sameDevice), "같은 기기로 인식되지 않았습니다.");
  assert.deepEqual(
    lobby.players.map((player) => player.name),
    ["가람", "나은", "다올"],
  );

  // 선생님 화면에는 세 명이 각각 보여야 한다.
  const seen = await teacher.wait(
    (m) => m.type === "hub_state" && m.rooms[0].connectedCount === 3,
    "선생님 화면 반영",
  );
  assert.equal(seen.rooms[0].players.length, 3);

  teacher.send({ type: "start_all" });
  const first = await tablet.wait(isState((m) => m.phase === "roll"), "게임 시작");
  assert.equal(first.currentPlayerName, "가람");
  assert.equal(first.isMyTurn, true, "이 기기가 첫 차례를 조작할 수 없습니다.");

  // 한 소켓으로 첫 차례를 진행한다.
  tablet.send({ type: "roll_dice" });
  const picking = await tablet.wait(isState((m) => m.phase === "pick"), "카드 고르기");
  assert.ok(picking.dice >= 1);

  tablet.close();
  teacher.close();
});

test("한 태블릿이 다른 기기의 차례까지 조작하지는 못한다", async () => {
  const teacher = client({ room: "NEW", role: "teacher" });
  await teacher.opened();
  teacher.send({ type: "create_hub", teacherName: "문수쌤", roomCount: 1 });
  const hubState = await teacher.wait((m) => m.type === "hub_state", "hub_state");
  const roomCode = hubState.rooms[0].code;

  const tablet = client({ room: roomCode, names: "가람,나은" });
  await tablet.opened();
  await tablet.wait((m) => m.type === "connected" && m.playerId, "태블릿 입장");

  const solo = client({ room: roomCode, name: "다올" });
  await solo.opened();
  await solo.wait((m) => m.type === "connected" && m.playerId, "개인 기기 입장");

  teacher.send({ type: "start_all" });
  await solo.wait(isState((m) => m.phase === "roll"), "게임 시작");

  // 첫 차례는 태블릿의 가람이다. 개인 기기는 조작할 수 없어야 한다.
  solo.send({ type: "roll_dice" });
  const error = await solo.wait((m) => m.type === "error", "차례 아님 오류");
  assert.match(error.message, /차례/);

  tablet.close();
  solo.close();
  teacher.close();
});

test("다른 게임 이름으로는 접속할 수 없다", async () => {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/v1/game?game=mafia-finder`);
  await new Promise((resolve) => {
    socket.on("error", resolve);
    socket.on("close", resolve);
    socket.on("open", () => resolve(new Error("열리면 안 됩니다.")));
  });
  assert.notEqual(socket.readyState, WebSocket.OPEN);
});

test("health 엔드포인트가 상태를 알려 준다", async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.game, "hidden-bomb");
  assert.equal(body.maxHubRooms, 7);
  assert.equal(body.maxPlayers, 4);
});
