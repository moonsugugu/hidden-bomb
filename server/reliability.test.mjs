import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

let server, port;
const sockets = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test.before(async () => {
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await once(server.stdout, "data", { signal: AbortSignal.timeout(5000) });
});
test.afterEach(() => { for (const socket of sockets.splice(0)) socket.terminate(); });
test.after(() => server?.kill());

async function client(params = {}) {
  const url = new URL(`ws://127.0.0.1:${port}/v1/game?game=hidden-bomb`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const socket = new WebSocket(url);
  const messages = [];
  socket.on("message", raw => messages.push(JSON.parse(raw.toString())));
  socket.on("error", () => {});
  sockets.push(socket);
  await once(socket, "open", { signal: AbortSignal.timeout(3000) });
  return {
    socket,
    messages,
    send: value => socket.send(JSON.stringify(value)),
    async wait(predicate) {
      for (let i = 0; i < 300; i++) {
        const found = messages.find(predicate);
        if (found) return found;
        await delay(10);
      }
      throw new Error("서버 응답 시간 초과");
    },
  };
}
async function hub(roomCount = 1) {
  const teacher = await client({ room: "NEW", role: "teacher" });
  teacher.send({ type: "create_hub", roomCount });
  const state = await teacher.wait(m => m.type === "hub_state");
  return { teacher, state, room: state.rooms[0].code };
}

test("null 설정 요청은 거절하고 같은 연결로 정상 방을 만들 수 있다", async () => {
  const c = await client({ room: "NEW" });
  c.send({ type: "create_room", name: "가람", config: null });
  await c.wait(m => m.type === "error");
  c.send({ type: "create_room", name: "가람", config: { deckSize: { toString: null } } });
  await c.wait(m => m.type === "room_created");
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.ok, true);
});

test("공개 참가자 ID나 같은 이름만으로 다른 학생 자리를 가져갈 수 없다", async () => {
  const { room } = await hub();
  const original = await client({ room, name: "가람" });
  const connected = await original.wait(m => m.type === "connected" && m.playerId);
  const state = await original.wait(m => m.type === "state");
  assert.equal(JSON.stringify(state).includes(connected.resumeToken), false);
  const other = await client({ room, name: "다른사람", playerId: connected.playerId });
  await other.wait(m => m.type === "error");
  assert.equal(original.socket.readyState, WebSocket.OPEN);
  original.socket.close();
  await once(original.socket, "close");
  const sameName = await client({ room, name: "가람" });
  await sameName.wait(m => m.type === "error");
  const authenticated = await client({ room, name: "가람", playerId: connected.playerId, resumeToken: connected.resumeToken });
  const back = await authenticated.wait(m => m.type === "connected" && m.playerId);
  assert.equal(back.playerId, connected.playerId);
});

test("모둠 1기기도 인증키로 원래 모둠 전체에 재접속한다", async () => {
  const { room } = await hub();
  const tablet = await client({ room, names: "가람,나은,다올" });
  const connected = await tablet.wait(m => m.type === "connected" && m.playerId);
  const again = await client({ room, playerId: connected.playerId, resumeToken: connected.resumeToken });
  const state = await again.wait(m => m.type === "state");
  assert.equal(state.players.length, 3);
  assert.ok(state.players.every(p => p.connected && p.sameDevice));
});

test("모둠을 삭제하면 학생과 관전 연결을 닫고 다른 모둠은 유지한다", async () => {
  const { teacher, state, room } = await hub(2);
  const student = await client({ room, name: "가람" });
  await student.wait(m => m.type === "state");
  const spectator = await client({ room, role: "teacher", watch: "1", hub: state.hub.code, teacherId: state.hub.teacherId });
  await spectator.wait(m => m.type === "state");
  const closed = Promise.all([student, spectator].map(c => once(c.socket, "close", { signal: AbortSignal.timeout(3000) })));
  teacher.send({ type: "remove_child_room", roomCode: room });
  assert.ok((await closed).every(([code]) => code === 1008));
  const remaining = await client({ room: state.rooms[1].code, name: "나은" });
  await remaining.wait(m => m.type === "state");
});

test("health는 접속·활동 인원과 실제 전송량 숫자만 제공한다", async () => {
  const { room } = await hub();
  const student = await client({ room, names: "계측친구1,계측친구2" });
  const connected = await student.wait(m => m.type === "connected" && m.playerId);
  await student.wait(m => m.type === "state");
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.ok(health.players >= 2);
  assert.ok(health.activePlayers >= 2);
  assert.ok(health.activeRooms >= 1);
  assert.ok(health.traffic.kbpsOut > 0);
  assert.equal(JSON.stringify(health).includes("계측친구"), false);
  assert.equal(JSON.stringify(health).includes(connected.resumeToken), false);
});
