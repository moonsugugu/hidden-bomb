import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, excel, timing, sessions;
test.before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    cacheDir: "node_modules/.vite-client-test",
    server: { middlewareMode: true, watch: null }, appType: "custom",
  });
  excel = await vite.ssrLoadModule("/src/excel.ts");
  timing = await vite.ssrLoadModule("/src/timing.ts");
  sessions = await vite.ssrLoadModule("/src/gameClient.ts");
});
test.after(async () => { delete globalThis.window; await vite?.close(); });
const file = (text, name = "questions.csv") => ({ name, text: async () => text });
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};

test("CSV의 쉼표·인용부호·줄바꿈을 문제와 해설 안에 보존한다", async () => {
  const parsed = await excel.parseQuestionFile(file('\uFEFF문장,정답(O/X),해설\r\n"사과, 배는 과일이다.",O,"\"\"사과\"\"는 과일이에요.\n배도 그래요."\r\n'));
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.items[0], { text: "사과, 배는 과일이다.", isTrue: true, explain: '"사과"는 과일이에요.\n배도 그래요.' });
});

test("TSV의 인용된 탭과 빈 줄도 안전하게 읽는다", async () => {
  const parsed = await excel.parseQuestionFile(file('문장\t정답(O/X)\t해설\n\n"탭\t포함 문장"\tX\t설명\n', "questions.tsv"));
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].text, "탭\t포함 문장");
  assert.equal(parsed.items[0].isTrue, false);
});

test("제목 행이 없어도 문제라는 단어가 든 첫 문항을 버리지 않는다", async () => {
  const parsed = await excel.parseQuestionFile(file("이 문제는 맞는 문장이다.,O,설명\n둘째 문항,X,설명"));
  assert.equal(parsed.items.length, 2);
  assert.equal((await excel.parseQuestionFile(file("문장,O,짧은 문항"))).items.length, 1);
});

test("닫히지 않은 따옴표는 일부 문항만 적용하지 않고 오류를 낸다", async () => {
  await assert.rejects(excel.parseQuestionFile(file('문장,정답(O/X),해설\n"닫히지 않은 문장,O,설명')), /따옴표/);
});

test("파일 문항의 길이와 개수가 서버 제한을 넘으면 명확하게 안내한다", () => {
  assert.throws(() => excel.rowsToItems([["가".repeat(161), "O", "해설"]]), /160자/);
  assert.throws(() => excel.rowsToItems([["문장", "O", "나".repeat(201)]]), /200자/);
  assert.throws(() => excel.rowsToItems(Array.from({ length: 201 }, (_, i) => [`문항${i}`, "O", "해설"])), /200개/);
});

test("태블릿 시계가 10분 달라도 서버 기준 남은 시간으로 카운트다운한다", t => {
  const serverTime = 1_000_000;
  t.mock.method(Date, "now", () => serverTime + 600_000);
  assert.equal(timing.countdownRatio(serverTime + 6000, serverTime, 100, 3100, 6000), 0.5);
  assert.equal(timing.countdownRatio(serverTime + 6000, serverTime, 100, 7100, 6000), 0);
});

test("판정 도중 다시 들어오면 남은 3초를 6초로 표시하지 않는다", () => {
  assert.equal(timing.countdownRatio(1_006_000, 1_003_000, 100, 100, 6000), 0.5);
  assert.equal(timing.countdownRatio(1_006_000, 1_003_000, 100, 3100, 6000), 0);
});

test("짧게 연결됐다 끊겨도 재시도 간격을 늘리고 10초 안정 후 초기화한다", () => {
  assert.deepEqual(timing.nextReconnect(1, 500, true), { delay: 1600, attempt: 2 });
  assert.deepEqual(timing.nextReconnect(2, 500, true), { delay: 3200, attempt: 3 });
  assert.deepEqual(timing.nextReconnect(2, 10_000, true), { delay: 800, attempt: 1 });
  assert.deepEqual(timing.nextReconnect(2, 10_000, false), { delay: 3200, attempt: 3 });
  assert.equal(timing.nextReconnect(100, 500, true).delay, 15_000);
});

test("같은 브라우저의 학생 탭이 교사 탭의 새로고침 대상을 덮어쓰지 않는다", () => {
  const shared = storage();
  const teacher = { localStorage: shared, sessionStorage: storage() };
  const student = { localStorage: shared, sessionStorage: storage() };
  globalThis.window = teacher;
  sessions.rememberSession("teacher", "T1234", "선생님");
  globalThis.window = student;
  sessions.rememberSession("student", "S1234", "학생");
  assert.equal(sessions.lastSession().room, "S1234");
  globalThis.window = teacher;
  assert.equal(sessions.lastSession().room, "T1234");
  sessions.clearSession();
  globalThis.window = student;
  assert.equal(sessions.lastSession().room, "S1234");
});

test("손상된 저장 정보로 자동 입장을 시도하지 않는다", () => {
  globalThis.window = { localStorage: storage(), sessionStorage: storage() };
  window.localStorage.setItem("hidden-bomb-last", '{"kind":"teacher","room":{},"name":"선생님"}');
  assert.equal(sessions.lastSession(), null);
});
