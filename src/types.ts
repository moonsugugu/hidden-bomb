export type GradeBand = "g12" | "g34" | "g56";
export type Subject = "math" | "science" | "social" | "korean" | "english";
export type Operation = "add" | "sub" | "mul" | "div";
export type QuestionType = "arithmetic" | "spelling" | "proposition" | "custom";
export type Scoring = "allOrNothing" | "partial";

export type Phase =
  | "lobby"
  | "roll"
  | "pick"
  | "judge"
  | "reveal"
  | "turnEnd"
  | "finished";

export type Config = {
  questionType: QuestionType;
  gradeBand: GradeBand;
  subject: Subject;
  operations: Operation[];
  gridSize: number;
  deckSize: number;
  bombRatio: number;
  diceMax: number;
  judgeMode: boolean;
  scoring: Scoring;
  targetScore: number;
  customCount: number;
  /** 지금 설정으로 뽑을 수 있는 문제 수. -1이면 제한 없음(연산 자동 생성). */
  availableQuestions: number;
  /** 시작하는 데 필요한 최소 문제 수. */
  requiredQuestions: number;
};

export type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  seat: number;
  isHost: boolean;
  isTurn: boolean;
  isMe: boolean;
  /** 모둠 1기기 모드에서 나와 같은 기기를 쓰는 친구인지. */
  sameDevice: boolean;
};

export type GridSlot = {
  index: number;
  empty: boolean;
  faceUp?: boolean;
  text?: string;
  isTrue?: boolean | null;
  explain?: string | null;
  safe?: boolean | null;
  playerAnswer?: "O" | "X" | null;
};

export type TurnResult = {
  playerId: string | null;
  playerName: string;
  success: boolean;
  dice: number;
  cleared: number;
  target: number;
  gained: number;
};

export type LogEntry = {
  ts: number;
  playerId: string | null;
  playerName: string;
  cardId: string;
  text: string;
  isTrue: boolean;
  explain: string;
  tag: string;
  playerAnswer: "O" | "X" | null;
  safe: boolean;
};

export type GameResult = {
  reason: "deckEmpty" | "target" | "stopped";
  ranking: { id: string; name: string; score: number }[];
  winners: string[];
  bombs: LogEntry[];
  totalCards: number;
};

export type GameState = {
  type: "state";
  room: string;
  label: string;
  kind: string;
  hubCode: string | null;
  phase: Phase;
  round: number;
  config: Config;
  players: Player[];
  grid: GridSlot[];
  dice: number;
  streak: number;
  streakTarget: number;
  currentPlayerId: string | null;
  currentPlayerName: string;
  /** 이 기기가 지금 조작할 수 있는지. 1기기 모드에서는 같은 기기 친구 차례도 포함된다. */
  isMyTurn: boolean;
  /** 한 기기를 여러 명이 나눠 쓰는 중인지. */
  sharedDevice: boolean;
  isHost: boolean;
  deckLeft: number;
  cardsRemaining: number;
  turnResult: TurnResult | null;
  result: GameResult | null;
  revealEndsAt: number | null;
  turnEndEndsAt: number | null;
  turnDeadline: number | null;
  minPlayers: number;
  maxPlayers: number;
  serverTime: number;
};

export type RoomSummary = {
  code: string;
  label: string;
  phase: Phase;
  round: number;
  playerCount: number;
  connectedCount: number;
  maxPlayers: number;
  minPlayers: number;
  players: { id: string; name: string; score: number; connected: boolean; isTurn: boolean }[];
  currentPlayerName: string;
  deckLeft: number;
  cardsRemaining: number;
  cardsPlayed: number;
  bombsHit: number;
  questionCount: number;
  config: Config;
  result: GameResult | null;
};

export type HeatmapEntry = {
  text: string;
  explain: string;
  isTrue: boolean;
  tag: string;
  count: number;
};

export type HubState = {
  type: "hub_state";
  hub: {
    code: string;
    teacherId: string;
    teacherName: string;
    maxRooms: number;
    roomCount: number;
  };
  rooms: RoomSummary[];
  heatmap: HeatmapEntry[];
  serverTime: number;
};

export type ServerMessage =
  | GameState
  | HubState
  | { type: "connected"; room?: string | null; playerId?: string; hub?: string; teacherId?: string; game?: string; canCreate?: boolean; role?: string }
  | { type: "room_created"; room: string; playerId: string }
  | { type: "hub_created"; hub: string; teacherId: string }
  | { type: "error"; message: string }
  | { type: "notice"; message: string };

export type CustomItem = { text: string; isTrue: boolean; explain: string };
