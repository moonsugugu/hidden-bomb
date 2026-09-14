import { randomUUID } from "node:crypto";
import { generateArithmetic, availableOperations, OPERATIONS } from "./generators.mjs";
import { generateSpelling, generateProposition, poolSize, SUBJECTS } from "./question-bank.mjs";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const MAX_HUB_ROOMS = 7;

export const GRID_SIZES = [9, 16];
export const DICE_MAX_OPTIONS = [3, 4, 6];
export const QUESTION_TYPES = ["arithmetic", "spelling", "proposition", "custom"];
export const SCORING_MODES = ["allOrNothing", "partial"];
export const GRADE_LEVELS = [1, 2, 3, 4, 5, 6];
export const GRADE_BANDS = ["g12", "g34", "g56"];

export function gradeBandForLevel(level) {
  if (Number(level) <= 2) return "g12";
  if (Number(level) <= 4) return "g34";
  return "g56";
}

function defaultGradeLevelForBand(gradeBand) {
  if (gradeBand === "g12") return 2;
  if (gradeBand === "g56") return 6;
  return 4;
}

// 정답 카드는 확인만 하면 되지만 폭탄은 해설을 읽을 시간이 필요하다.
export const REVEAL_SAFE_MS = 1_600;
export const REVEAL_BOMB_MS = 4_500;
export const TURN_END_MS = 3_000;
// 무응답으로 방이 멈추지 않도록 턴에 제한 시간을 둔다.
export const TURN_TIMEOUT_MS = 60_000;
// 접속이 끊긴 사람의 턴은 짧게 기다렸다가 넘긴다.
export const DISCONNECT_GRACE_MS = 15_000;

// 카드를 연 뒤 사람이 판정 버튼을 누르는 게 아니라, 방 전체가 문장을 함께 읽고
// 이 시간이 지나면 서버가 카드의 실제 참·거짓 그대로 자동으로 공개한다.
export const MIN_JUDGE_SECONDS = 3;
export const MAX_JUDGE_SECONDS = 15;
export const DEFAULT_JUDGE_SECONDS = 6;

export const MAX_CUSTOM_ITEMS = 200;
export const MAX_TEXT_LENGTH = 160;
export const MAX_EXPLAIN_LENGTH = 200;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeRoomCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 12);
}

export function normalizeName(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 12);
}

function normalizeText(value, limit) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** 엑셀에서 올라온 문제를 서버에서 한 번 더 검증한다. 클라이언트 값을 믿지 않는다. */
export function normalizeCustomItems(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  const seen = new Set();
  for (const row of value.slice(0, MAX_CUSTOM_ITEMS * 2)) {
    const text = normalizeText(row?.text, MAX_TEXT_LENGTH);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: randomUUID().slice(0, 8),
      text,
      isTrue: Boolean(row?.isTrue),
      explain: normalizeText(row?.explain, MAX_EXPLAIN_LENGTH),
      tag: "custom",
    });
    if (items.length >= MAX_CUSTOM_ITEMS) break;
  }
  return items;
}

export function normalizeConfig(input = {}) {
  const questionType = QUESTION_TYPES.includes(input.questionType)
    ? input.questionType
    : "arithmetic";
  const legacyGradeBand = GRADE_BANDS.includes(input.gradeBand) ? input.gradeBand : "g34";
  const requestedGrade = Number(input.gradeLevel);
  const gradeLevel = GRADE_LEVELS.includes(requestedGrade)
    ? requestedGrade
    : defaultGradeLevelForBand(legacyGradeBand);
  const gradeBand = gradeBandForLevel(gradeLevel);
  const subject = SUBJECTS.includes(input.subject) ? input.subject : "math";
  const requested = Array.isArray(input.operations)
    ? input.operations.filter((op) => OPERATIONS.includes(op))
    : [];
  // 학년군에서 배우지 않는 연산은 골라도 제외한다. (1~2학년 나눗셈 등)
  const allowed = availableOperations(gradeBand);
  const operations = requested.filter((op) => allowed.includes(op));
  return {
    questionType,
    gradeBand,
    gradeLevel,
    subject,
    operations: operations.length ? operations : allowed,
    gridSize: GRID_SIZES.includes(Number(input.gridSize)) ? Number(input.gridSize) : 9,
    deckSize: clamp(Math.round(Number(input.deckSize) || 40), 12, 60),
    bombRatio: clamp(Number(input.bombRatio) || 0.3, 0.1, 0.5),
    diceMax: DICE_MAX_OPTIONS.includes(Number(input.diceMax)) ? Number(input.diceMax) : 4,
    // 카드를 열고 몇 초 뒤에 자동으로 공개할지. 판정은 항상 자동이고 사람이 누르지 않는다.
    judgeSeconds: clamp(
      Math.round(Number(input.judgeSeconds) || DEFAULT_JUDGE_SECONDS),
      MIN_JUDGE_SECONDS,
      MAX_JUDGE_SECONDS,
    ),
    scoring: SCORING_MODES.includes(input.scoring) ? input.scoring : "allOrNothing",
    targetScore: clamp(Math.round(Number(input.targetScore) || 0), 0, 50),
    customItems: normalizeCustomItems(input.customItems),
  };
}

/** 설정에 맞는 카드 덱을 만든다. 문제은행이 모자라면 있는 만큼만 담는다. */
export function buildDeck(config, rng = Math.random) {
  const bombCount = Math.round(config.deckSize * config.bombRatio);
  const options = {
    gradeBand: config.gradeBand,
    count: config.deckSize,
    bombCount,
    rng,
  };
  if (config.questionType === "spelling") return generateSpelling(options);
  if (config.questionType === "proposition")
    return generateProposition({ ...options, subject: config.subject });
  if (config.questionType === "custom") {
    const items = [...config.customItems];
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(rng() * (index + 1));
      [items[index], items[swap]] = [items[swap], items[index]];
    }
    return items.slice(0, config.deckSize);
  }
  return generateArithmetic({ ...options, operations: config.operations });
}

export class BombRoom {
  constructor(code, config = {}, options = {}) {
    this.code = normalizeRoomCode(code);
    this.config = normalizeConfig(config);
    this.kind = options.kind || "student";
    this.hubCode = options.hubCode || null;
    this.controllerId = options.controllerId || null;
    this.label = options.label || "";
    this.hostId = null;
    this.players = new Map();
    this.phase = "lobby";
    this.deck = [];
    this.grid = [];
    this.turnOrder = [];
    this.turnIndex = 0;
    this.dice = 0;
    this.streak = 0;
    this.streakTarget = 0;
    this.pending = null;
    this.turnResult = null;
    this.log = [];
    this.round = 0;
    this.result = null;
    this.revealEndsAt = null;
    this.turnEndEndsAt = null;
    this.turnDeadline = null;
    // 카드를 연 뒤 자동 공개까지 남은 시간. 사람이 누르는 판정 버튼은 없다.
    this.judgeEndsAt = null;
    // 현재 차례 친구가 살펴보는 카드의 자리. 내용은 공개하지 않는다.
    this.highlightedIndex = null;
    this.createdAt = Date.now();
    this.emptySince = null;
  }

  /* ── 참가자 ─────────────────────────────────────────── */

  addPlayer({ id = randomUUID(), name, isHost = false, ownerId = null }) {
    const cleanName = normalizeName(name);
    if (!cleanName) return { ok: false, error: "이름을 입력해 주세요." };
    if (this.phase !== "lobby")
      return { ok: false, error: "게임이 이미 시작되어 들어갈 수 없어요." };
    if (this.connectedPlayers().length >= MAX_PLAYERS)
      return { ok: false, error: `이 방은 ${MAX_PLAYERS}명이 꽉 찼어요.` };
    if (
      [...this.players.values()].some(
        (player) => player.connected && player.name.toLowerCase() === cleanName.toLowerCase(),
      )
    )
      return { ok: false, error: "같은 이름의 친구가 이미 있어요." };
    const player = {
      id,
      name: cleanName,
      connected: true,
      score: 0,
      seat: this.players.size,
      // 한 기기가 여러 명을 맡는 모둠 1기기 모드에서는 같은 ownerId를 공유한다.
      // 혼자 들어온 사람은 자기 자신이 주인이다.
      ownerId: ownerId || id,
    };
    this.players.set(id, player);
    if ((!this.hostId && !this.controllerId) || isHost) this.hostId = id;
    this.emptySince = null;
    return { ok: true, player };
  }

  /**
   * 한 기기로 여러 명이 참여할 때 쓴다. (태블릿이 모둠당 한 대뿐인 교실)
   * 이름 하나라도 문제가 있으면 아무도 넣지 않는다. 반쯤 들어간 상태가 더 헷갈린다.
   */
  addPlayers(names) {
    const cleaned = (Array.isArray(names) ? names : [])
      .map((name) => normalizeName(name))
      .filter(Boolean);
    if (!cleaned.length) return { ok: false, error: "이름을 입력해 주세요." };
    if (this.phase !== "lobby")
      return { ok: false, error: "게임이 이미 시작되어 들어갈 수 없어요." };
    if (this.connectedPlayers().length + cleaned.length > MAX_PLAYERS)
      return { ok: false, error: `이 방은 ${MAX_PLAYERS}명까지만 들어갈 수 있어요.` };

    const lowered = cleaned.map((name) => name.toLowerCase());
    if (new Set(lowered).size !== lowered.length)
      return { ok: false, error: "같은 이름을 두 번 적었어요." };
    const taken = new Set(
      [...this.players.values()]
        .filter((player) => player.connected)
        .map((player) => player.name.toLowerCase()),
    );
    const clash = cleaned.find((name) => taken.has(name.toLowerCase()));
    if (clash) return { ok: false, error: `'${clash}' 이름을 쓰는 친구가 이미 있어요.` };

    const ownerId = randomUUID();
    const added = cleaned.map(
      (name) => this.addPlayer({ id: randomUUID(), name, ownerId }).player,
    );
    return { ok: true, players: added, primary: added[0] };
  }

  /** actorId가 targetId 대신 조작할 수 있는지. 같은 기기를 쓰면 서로 대신할 수 있다. */
  controls(actorId, targetId) {
    if (!actorId || !targetId) return false;
    if (actorId === targetId) return true;
    const actor = this.getPlayer(actorId);
    const target = this.getPlayer(targetId);
    return Boolean(actor && target && actor.ownerId === target.ownerId);
  }

  /** 같은 기기를 쓰는 참가자들. */
  groupOf(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return [];
    return [...this.players.values()].filter((other) => other.ownerId === player.ownerId);
  }

  reconnectPlayer(id, name) {
    const player = this.players.get(id);
    if (!player) return { ok: false, error: "재입장할 참가자를 찾지 못했어요." };
    const cleanName = normalizeName(name);
    if (cleanName && cleanName !== player.name && this.groupOf(id).length === 1) {
      // 한 기기가 여러 명을 맡는 경우에는 이름을 바꾸지 않는다.
      // 재접속할 때 넘어온 이름은 그중 한 명일 뿐이다.
      const duplicate = [...this.players.values()].some(
        (other) =>
          other.id !== id &&
          other.connected &&
          other.name.toLowerCase() === cleanName.toLowerCase(),
      );
      if (duplicate) return { ok: false, error: "같은 이름의 친구가 이미 있어요." };
      player.name = cleanName;
    }
    // 기기를 함께 쓰는 참가자는 다 같이 돌아온다.
    for (const member of this.groupOf(id)) member.connected = true;
    this.emptySince = null;
    return { ok: true, player };
  }

  setConnected(id, connected) {
    const player = this.players.get(id);
    if (!player) return false;
    // 기기 하나가 끊기면 그 기기를 쓰던 참가자가 다 같이 끊긴다.
    const group = this.groupOf(id);
    for (const member of group) member.connected = connected;
    if (!connected && [...this.players.values()].every((item) => !item.connected))
      this.emptySince = Date.now();
    // 끊긴 기기의 차례면 방 전체가 멈추므로 대기 시간을 짧게 줄인다.
    // judge·reveal·turnEnd 단계는 사람 조작 없이 시간이 지나면 저절로 넘어가므로 해당 없다.
    const currentId = this.currentPlayerId();
    if (
      !connected &&
      ["roll", "pick"].includes(this.phase) &&
      group.some((member) => member.id === currentId)
    ) {
      this.turnDeadline = Date.now() + DISCONNECT_GRACE_MS;
      return true;
    }
    return false;
  }

  getPlayer(id) {
    return this.players.get(id) || null;
  }

  connectedPlayers() {
    return [...this.players.values()].filter((player) => player.connected);
  }

  seatedPlayers() {
    return [...this.players.values()].sort((a, b) => a.seat - b.seat);
  }

  canHost(id) {
    return id === this.hostId || (this.controllerId && id === this.controllerId);
  }

  isPlaying() {
    return ["roll", "pick", "judge", "reveal", "turnEnd"].includes(this.phase);
  }

  currentPlayerId() {
    return this.turnOrder[this.turnIndex] || null;
  }

  /* ── 설정 ───────────────────────────────────────────── */

  updateSettings(input) {
    if (this.phase !== "lobby" && this.phase !== "finished")
      return { ok: false, error: "게임 중에는 설정을 바꿀 수 없어요." };
    // 이미 올려 둔 엑셀 문제는 설정만 바꿔도 유지되어야 한다.
    const keepCustom = this.config.customItems;
    const merged = { ...this.config, customItems: keepCustom, ...input };
    // 오래된 클라이언트는 gradeBand만 보낸다. 이때 기존 gradeLevel이
    // 새 학년군 선택을 덮어쓰지 않도록 band를 우선한다.
    if (Object.prototype.hasOwnProperty.call(input, "gradeBand") &&
        !Object.prototype.hasOwnProperty.call(input, "gradeLevel"))
      delete merged.gradeLevel;
    this.config = normalizeConfig(merged);
    if (!this.config.customItems.length && keepCustom.length)
      this.config.customItems = keepCustom;
    return { ok: true };
  }

  setQuestions(items) {
    if (this.phase !== "lobby" && this.phase !== "finished")
      return { ok: false, error: "게임 중에는 문제를 바꿀 수 없어요." };
    const normalized = normalizeCustomItems(items);
    if (normalized.length < 8)
      return { ok: false, error: "문제가 너무 적어요. 8개 이상 올려 주세요." };
    this.config.customItems = normalized;
    this.config.questionType = "custom";
    return { ok: true, count: normalized.length };
  }

  /* ── 게임 진행 ──────────────────────────────────────── */

  start() {
    const players = this.connectedPlayers();
    if (players.length < MIN_PLAYERS)
      return { ok: false, error: `${MIN_PLAYERS}명 이상 모여야 시작할 수 있어요.` };

    const deck = buildDeck(this.config);
    const needed = this.requiredQuestions();
    if (deck.length < needed)
      return {
        ok: false,
        error: `문제가 ${deck.length}개뿐이라 시작할 수 없어요. ${needed}개 이상 필요해요.`,
      };

    this.deck = deck;
    this.grid = [];
    for (let index = 0; index < this.config.gridSize; index += 1)
      this.grid.push(this.deck.length ? { card: this.deck.pop() } : null);

    this.turnOrder = players.sort((a, b) => a.seat - b.seat).map((player) => player.id);
    this.turnIndex = 0;
    this.round = 1;
    this.log = [];
    this.result = null;
    this.turnResult = null;
    this.pending = null;
    for (const player of this.players.values()) player.score = 0;
    this.beginTurn();
    return { ok: true };
  }

  beginTurn() {
    this.phase = "roll";
    this.dice = 0;
    this.streak = 0;
    this.streakTarget = 0;
    this.pending = null;
    this.revealEndsAt = null;
    this.turnEndEndsAt = null;
    this.judgeEndsAt = null;
    this.highlightedIndex = null;
    this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
  }

  cardsOnGrid() {
    return this.grid.filter(Boolean).length;
  }

  cardsRemaining() {
    return this.deck.length + this.cardsOnGrid();
  }

  rollDice(playerId) {
    if (this.phase !== "roll") return { ok: false, error: "지금은 주사위를 굴릴 때가 아니에요." };
    if (!this.controls(playerId, this.currentPlayerId()))
      return { ok: false, error: "지금은 내 차례가 아니에요." };
    this.dice = 1 + Math.floor(Math.random() * this.config.diceMax);
    // 남은 카드보다 많은 숫자가 나오면 남은 만큼만 맞히면 성공으로 친다.
    this.streakTarget = Math.min(this.dice, this.cardsOnGrid());
    this.streak = 0;
    this.phase = "pick";
    this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    return { ok: true };
  }

  pickCard(playerId, rawIndex) {
    if (this.phase !== "pick") return { ok: false, error: "지금은 카드를 고를 때가 아니에요." };
    if (!this.controls(playerId, this.currentPlayerId()))
      return { ok: false, error: "지금은 내 차례가 아니에요." };
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= this.grid.length)
      return { ok: false, error: "그 자리에는 카드가 없어요." };
    const slot = this.grid[index];
    if (!slot) return { ok: false, error: "그 자리에는 카드가 없어요." };

    // 카드를 열면 문장이 방 전체에 공개된다. 판정은 사람이 누르지 않고
    // 설정한 초(judgeSeconds)가 지나면 서버가 카드의 실제 참·거짓 그대로 자동 공개한다.
    this.pending = { slotIndex: index, card: slot.card, playerAnswer: null, safe: null };
    this.highlightedIndex = index;
    this.phase = "judge";
    this.judgeEndsAt = Date.now() + this.config.judgeSeconds * 1_000;
    // 이 단계는 자동으로 끝나므로 사람이 응답을 못 해도 멈추지 않는다. 턴 전체 제한은 끈다.
    this.turnDeadline = null;
    return { ok: true };
  }

  /** 판정 대기 시간이 끝나 카드의 실제 참·거짓 그대로 공개한다. 사람이 개입하지 않는다. */
  resolveCard(safe, playerAnswer) {
    const card = this.pending.card;
    const player = this.getPlayer(this.currentPlayerId());
    this.pending.safe = safe;
    this.pending.playerAnswer = playerAnswer;
    this.judgeEndsAt = null;

    this.log.push({
      ts: Date.now(),
      playerId: player?.id || null,
      playerName: player?.name || "",
      cardId: card.id,
      text: card.text,
      isTrue: card.isTrue,
      explain: card.explain,
      tag: card.tag,
      playerAnswer,
      safe,
    });

    if (safe) this.streak += 1;
    this.phase = "reveal";
    this.revealEndsAt = Date.now() + (safe ? REVEAL_SAFE_MS : REVEAL_BOMB_MS);
    return { ok: true };
  }

  /** 공개가 끝난 카드를 치우고 더미에서 새 카드로 채운다. */
  consumePendingCard() {
    if (!this.pending) return;
    const { slotIndex } = this.pending;
    this.grid[slotIndex] = this.deck.length ? { card: this.deck.pop() } : null;
    this.pending = null;
    this.highlightedIndex = null;
  }

  /** 현재 차례 친구가 살펴보는 카드를 방 전체에 표시한다. 내용은 전혀 공개하지 않는다. */
  previewCard(playerId, rawIndex) {
    // 포인터가 카드를 떠난 뒤에는 이미 판정 단계일 수 있으므로 조용히 무시한다.
    if (this.phase !== "pick" || !this.controls(playerId, this.currentPlayerId()))
      return { ok: true };
    if (rawIndex === null || rawIndex === undefined || rawIndex === "") {
      this.highlightedIndex = null;
      return { ok: true };
    }
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= this.grid.length || !this.grid[index])
      return { ok: false, error: "그 자리에는 카드가 없어요." };
    this.highlightedIndex = index;
    return { ok: true };
  }

  advanceFromReveal() {
    const safe = this.pending?.safe;
    this.consumePendingCard();
    this.revealEndsAt = null;

    if (!safe) return this.endTurn(false);
    if (this.streak >= this.streakTarget) return this.endTurn(true);
    if (this.cardsOnGrid() === 0) return this.endTurn(true);

    this.phase = "pick";
    this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
  }

  endTurn(success) {
    const player = this.getPlayer(this.currentPlayerId());
    const gained =
      this.config.scoring === "partial" ? this.streak : success ? this.streakTarget : 0;
    if (player) player.score += gained;
    this.turnResult = {
      playerId: player?.id || null,
      playerName: player?.name || "",
      success,
      dice: this.dice,
      cleared: this.streak,
      target: this.streakTarget,
      gained,
    };
    this.phase = "turnEnd";
    this.turnEndEndsAt = Date.now() + TURN_END_MS;
    this.turnDeadline = null;
    this.highlightedIndex = null;
  }

  nextTurn() {
    this.turnEndEndsAt = null;
    if (this.checkGameEnd()) return;

    // 접속이 끊긴 사람은 건너뛴다. 한 바퀴 돌아도 아무도 없으면 그대로 기다린다.
    for (let step = 1; step <= this.turnOrder.length; step += 1) {
      const nextIndex = (this.turnIndex + step) % this.turnOrder.length;
      const player = this.getPlayer(this.turnOrder[nextIndex]);
      if (player?.connected) {
        if (nextIndex <= this.turnIndex) this.round += 1;
        this.turnIndex = nextIndex;
        this.beginTurn();
        return;
      }
    }
    this.beginTurn();
  }

  checkGameEnd() {
    const target = this.config.targetScore;
    const reached = target > 0 && [...this.players.values()].some((p) => p.score >= target);
    if (!reached && this.cardsRemaining() > 0) return false;
    this.finish(reached ? "target" : "deckEmpty");
    return true;
  }

  finish(reason) {
    this.phase = "finished";
    this.pending = null;
    this.highlightedIndex = null;
    this.revealEndsAt = null;
    this.turnEndEndsAt = null;
    this.turnDeadline = null;
    this.judgeEndsAt = null;
    const ranking = this.seatedPlayers()
      .map((player) => ({ id: player.id, name: player.name, score: player.score }))
      .sort((a, b) => b.score - a.score);
    const topScore = ranking[0]?.score ?? 0;
    this.result = {
      reason,
      ranking,
      winners: ranking.filter((entry) => entry.score === topScore).map((entry) => entry.name),
      bombs: this.log.filter((entry) => !entry.safe),
      totalCards: this.log.length,
    };
  }

  /** 시간이 지나서 저절로 넘어가야 하는 것들을 처리한다. 상태가 바뀌면 true. */
  tick(now = Date.now()) {
    if (this.phase === "judge" && this.judgeEndsAt && now >= this.judgeEndsAt) {
      // 사람이 판정하지 않는다. 카드에 적힌 실제 참·거짓 그대로 공개한다.
      this.resolveCard(this.pending.card.isTrue, null);
      return true;
    }
    if (this.phase === "reveal" && this.revealEndsAt && now >= this.revealEndsAt) {
      this.advanceFromReveal();
      return true;
    }
    if (this.phase === "turnEnd" && this.turnEndEndsAt && now >= this.turnEndEndsAt) {
      this.nextTurn();
      return true;
    }
    // roll·pick 단계만 사람의 조작을 기다린다. judge 단계는 judgeEndsAt이 대신 처리한다.
    if (["roll", "pick"].includes(this.phase) && this.turnDeadline && now >= this.turnDeadline) {
      // 제한 시간을 넘기면 그때까지 넘긴 만큼만 인정하고 다음 사람에게 넘긴다.
      this.pending = null;
      this.endTurn(false);
      return true;
    }
    return false;
  }

  rematch(playerId) {
    if (!this.canHost(playerId)) return { ok: false, error: "방장만 다시 시작할 수 있어요." };
    if (this.phase !== "finished") return { ok: false, error: "아직 게임이 끝나지 않았어요." };
    return this.start();
  }

  /* ── 메시지 처리 ────────────────────────────────────── */

  handle(playerId, message = {}) {
    switch (message.type) {
      case "start":
        if (!this.canHost(playerId))
          return { ok: false, error: "방장만 시작할 수 있어요." };
        return this.start();
      case "update_settings":
        if (!this.canHost(playerId))
          return { ok: false, error: "방장만 설정을 바꿀 수 있어요." };
        return this.updateSettings(message.config);
      case "set_questions":
        if (!this.canHost(playerId))
          return { ok: false, error: "방장만 문제를 올릴 수 있어요." };
        return this.setQuestions(message.items);
      case "roll_dice":
        return this.rollDice(playerId);
      case "pick_card":
        return this.pickCard(playerId, message.index);
      case "preview_card":
        return this.previewCard(playerId, message.index);
      case "judge":
        // 예전 클라이언트가 남아 있을 때를 대비한 안내. 이제 판정은 항상 자동이다.
        return { ok: false, error: "이 게임은 시간이 지나면 자동으로 판정돼요." };
      case "skip_turn":
        // 접속이 끊긴 사람 때문에 방이 멈췄을 때 선생님이 넘길 수 있게 한다.
        if (!this.canHost(playerId)) return { ok: false, error: "방장만 넘길 수 있어요." };
        if (!this.isPlaying()) return { ok: false, error: "지금은 넘길 수 없어요." };
        this.pending = null;
        this.endTurn(false);
        return { ok: true };
      case "rematch":
        return this.rematch(playerId);
      case "finish":
        if (!this.canHost(playerId)) return { ok: false, error: "방장만 끝낼 수 있어요." };
        if (this.phase === "lobby") return { ok: false, error: "아직 시작하지 않았어요." };
        this.finish("stopped");
        return { ok: true };
      default:
        return { ok: false, error: "알 수 없는 요청이에요." };
    }
  }

  /* ── 상태 전송 ──────────────────────────────────────── */

  publicPlayers(viewerId) {
    const currentId = this.currentPlayerId();
    return this.seatedPlayers().map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      connected: player.connected,
      seat: player.seat,
      isHost: this.canHost(player.id),
      isTurn: player.id === currentId,
      isMe: player.id === viewerId,
      // 모둠 1기기 모드에서 같은 태블릿을 쓰는 친구인지.
      sameDevice: this.controls(viewerId, player.id),
    }));
  }

  /**
   * 뒷면 카드의 내용은 절대 내려보내지 않는다.
   * 전체 덱을 미리 보내면 개발자 도구로 정답을 볼 수 있다.
   */
  publicGrid() {
    return this.grid.map((slot, index) => {
      if (!slot) return { index, empty: true };
      const isOpen = this.pending?.slotIndex === index;
      if (!isOpen) return { index, empty: false, faceUp: false };
      return {
        index,
        empty: false,
        faceUp: true,
        text: slot.card.text,
        // 판정 전에는 정답도 보내지 않는다.
        isTrue: this.phase === "reveal" ? slot.card.isTrue : null,
        explain: this.phase === "reveal" ? slot.card.explain : null,
        safe: this.phase === "reveal" ? this.pending.safe : null,
        playerAnswer: this.pending.playerAnswer,
      };
    });
  }

  /** 교사 대시보드용 요약. 방 하나를 한 줄로 보여 준다. */
  summary() {
    const bombsHit = this.log.filter((entry) => !entry.safe).length;
    return {
      code: this.code,
      label: this.label,
      phase: this.phase,
      round: this.round,
      playerCount: this.players.size,
      connectedCount: this.connectedPlayers().length,
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
      players: this.seatedPlayers().map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score,
        connected: player.connected,
        isTurn: player.id === this.currentPlayerId(),
      })),
      currentPlayerName: this.getPlayer(this.currentPlayerId())?.name || "",
      deckLeft: this.deck.length,
      cardsRemaining: this.cardsRemaining(),
      cardsPlayed: this.log.length,
      bombsHit,
      questionCount: this.config.customItems.length,
      config: this.settingsConfig(),
      result: this.result,
    };
  }

  /** 지금 설정으로 몇 장까지 뽑을 수 있는지. 연산은 무한히 만들 수 있다. */
  availableQuestions() {
    if (this.config.questionType === "arithmetic") return Infinity;
    if (this.config.questionType === "custom") return this.config.customItems.length;
    return poolSize({
      questionType: this.config.questionType,
      gradeBand: this.config.gradeBand,
      subject: this.config.subject,
      // 명제는 폭탄 비율에 따라 실제로 뽑히는 덱 크기가 달라진다.
      bombRatio: this.config.bombRatio,
    });
  }

  /** 시작하려면 최소 몇 장이 필요한지. 격자를 채우고 더미가 조금은 남아야 한다. */
  requiredQuestions() {
    return this.config.gridSize + 3;
  }

  settingsConfig() {
    const { customItems, ...rest } = this.config;
    const available = this.availableQuestions();
    return {
      ...rest,
      customCount: customItems.length,
      // Infinity는 JSON으로 못 보내므로 -1을 "제한 없음"으로 쓴다.
      availableQuestions: Number.isFinite(available) ? available : -1,
      requiredQuestions: this.requiredQuestions(),
    };
  }

  snapshotFor(viewerId, { spectator = false } = {}) {
    const currentId = this.currentPlayerId();
    return {
      type: "state",
      room: this.code,
      label: this.label,
      kind: this.kind,
      hubCode: this.hubCode,
      spectator,
      phase: this.phase,
      round: this.round,
      config: this.settingsConfig(),
      players: this.publicPlayers(viewerId),
      grid: this.publicGrid(),
      dice: this.dice,
      streak: this.streak,
      streakTarget: this.streakTarget,
      currentPlayerId: currentId,
      currentPlayerName: this.getPlayer(currentId)?.name || "",
      // 이 기기가 지금 조작할 수 있는지. 모둠 1기기 모드에서는 같은 기기의 친구 차례도 포함된다.
      isMyTurn: spectator ? false : this.controls(viewerId, currentId),
      // 한 기기를 여러 명이 나눠 쓰는 중인지. 화면에 "기기를 넘겨 주세요"를 띄우는 데 쓴다.
      sharedDevice: spectator ? false : this.groupOf(viewerId).length > 1,
      isHost: spectator ? false : this.canHost(viewerId),
      deckLeft: this.deck.length,
      cardsRemaining: this.cardsRemaining(),
      turnResult: this.turnResult,
      result: this.result,
      revealEndsAt: this.revealEndsAt,
      turnEndEndsAt: this.turnEndEndsAt,
      turnDeadline: this.turnDeadline,
      highlightedIndex: this.highlightedIndex,
      // 카드를 연 뒤 자동으로 공개되기까지 남은 시각. 방 전체가 같은 값을 본다.
      judgeEndsAt: this.judgeEndsAt,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      serverTime: Date.now(),
    };
  }
}

export class TeacherHub {
  constructor(code, teacherId, teacherName, roomCount = 1) {
    this.code = normalizeRoomCode(code);
    this.teacherId = teacherId || randomUUID();
    this.teacherName = normalizeName(teacherName) || "담임 선생님";
    this.rooms = new Map();
    this.createdAt = Date.now();
    this.emptySince = null;
    const count = clamp(Math.round(Number(roomCount) || 1), 1, MAX_HUB_ROOMS);
    for (let index = 0; index < count; index += 1) this.createChildRoom({}, `${index + 1}모둠`);
  }

  createChildRoom(config = {}, label) {
    if (this.rooms.size >= MAX_HUB_ROOMS)
      return { ok: false, error: `방은 최대 ${MAX_HUB_ROOMS}개까지 만들 수 있어요.` };
    let code;
    do code = `S${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    while (this.rooms.has(code));
    const room = new BombRoom(code, config, {
      kind: "student",
      hubCode: this.code,
      controllerId: this.teacherId,
      label: normalizeName(label) || `${this.rooms.size + 1}모둠`,
    });
    this.rooms.set(code, room);
    return { ok: true, room };
  }

  removeChildRoom(code) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: "방을 찾을 수 없어요." };
    if (this.rooms.size <= 1) return { ok: false, error: "방은 하나 이상 있어야 해요." };
    this.rooms.delete(room.code);
    return { ok: true, code: room.code };
  }

  getRoom(code) {
    return this.rooms.get(normalizeRoomCode(code)) || null;
  }

  /** 모든 방에 같은 설정을 한 번에 적용한다. */
  applyToAll(config) {
    const failures = [];
    for (const room of this.rooms.values()) {
      const result = room.updateSettings(config);
      if (!result.ok) failures.push(`${room.label}: ${result.error}`);
    }
    return failures.length ? { ok: false, error: failures.join(" / ") } : { ok: true };
  }

  startAll() {
    const started = [];
    const failures = [];
    for (const room of this.rooms.values()) {
      if (room.phase !== "lobby" && room.phase !== "finished") continue;
      const result = room.start();
      if (result.ok) started.push(room.label);
      else failures.push(`${room.label}: ${result.error}`);
    }
    return { ok: true, started, failures };
  }

  /** 어떤 문제에서 폭탄이 많이 터졌는지 모아 준다. 수업 마무리 자료로 쓴다. */
  bombHeatmap() {
    const counts = new Map();
    for (const room of this.rooms.values()) {
      for (const entry of room.log) {
        if (entry.safe) continue;
        const current = counts.get(entry.text) || {
          text: entry.text,
          explain: entry.explain,
          isTrue: entry.isTrue,
          tag: entry.tag,
          count: 0,
        };
        current.count += 1;
        counts.set(entry.text, current);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  }

  snapshot() {
    return {
      type: "hub_state",
      hub: {
        code: this.code,
        teacherId: this.teacherId,
        teacherName: this.teacherName,
        maxRooms: MAX_HUB_ROOMS,
        roomCount: this.rooms.size,
      },
      rooms: [...this.rooms.values()].map((room) => room.summary()),
      heatmap: this.bombHeatmap(),
      serverTime: Date.now(),
    };
  }
}
