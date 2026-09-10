import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState, GridSlot } from "./types";
import { PHASE_LABELS, describeConfig } from "./labels";
import { downloadBombReport } from "./excel";
import { playSound } from "./sound";

type Props = {
  state: GameState;
  send: (message: Record<string, unknown>) => void;
  onLeave: () => void;
  spectator?: boolean;
};

/** 서버가 정한 종료 시각까지 남은 비율(0~1). 공개 시간이 얼마나 남았는지 보여 준다. */
function useCountdown(endsAt: number | null, serverTime: number) {
  const [ratio, setRatio] = useState(1);
  const startRef = useRef<{ endsAt: number; total: number } | null>(null);

  useEffect(() => {
    if (!endsAt) {
      startRef.current = null;
      setRatio(1);
      return;
    }
    const total = Math.max(1, endsAt - serverTime);
    startRef.current = { endsAt, total };
    const tick = () => {
      const current = startRef.current;
      if (!current) return;
      const left = current.endsAt - Date.now();
      setRatio(Math.max(0, Math.min(1, left / current.total)));
    };
    tick();
    const timer = window.setInterval(tick, 80);
    return () => window.clearInterval(timer);
    // serverTime은 매 상태마다 바뀌므로 endsAt이 바뀔 때만 다시 잡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);

  return ratio;
}

function Scoreboard({ state }: { state: GameState }) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <div className="scoreboard">
      {sorted.map((player) => (
        <div
          key={player.id}
          className={[
            "score-chip",
            player.isTurn ? "is-turn" : "",
            // 1기기 모드에서는 이 기기를 쓰는 친구를 모두 강조한다.
            player.sameDevice ? "is-me" : "",
            player.connected ? "" : "is-offline",
          ].join(" ")}
        >
          <span className="score-name">
            {player.name}
            {player.isMe && !state.sharedDevice ? " (나)" : ""}
          </span>
          <span className="score-value">{player.score}</span>
          {!player.connected && <span className="score-offline">끊김</span>}
        </div>
      ))}
    </div>
  );
}

function Dice({ value, rolling }: { value: number; rolling: boolean }) {
  return (
    <div className={`dice ${rolling ? "is-rolling" : ""}`} aria-label={`주사위 ${value}`}>
      {value || "?"}
    </div>
  );
}

function CardStage({ slot, phase }: { slot: GridSlot; phase: GameState["phase"] }) {
  const revealed = phase === "reveal";
  const safe = slot.safe;
  return (
    <div
      className={[
        "card-stage",
        revealed ? (safe ? "is-safe" : "is-bomb") : "is-open",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      <p className="card-stage-text">{slot.text}</p>
      {revealed && (
        <div className="card-stage-verdict">
          <p className="verdict-headline">
            {safe ? "✅ 안전!" : "💣 폭탄!"}
            <span className="verdict-truth">
              {slot.isTrue ? "이 문장은 맞아요" : "이 문장은 틀렸어요"}
            </span>
          </p>
          {slot.explain && <p className="verdict-explain">{slot.explain}</p>}
        </div>
      )}
    </div>
  );
}

function ResultView({
  state,
  send,
  onLeave,
}: {
  state: GameState;
  send: Props["send"];
  onLeave: () => void;
}) {
  const result = state.result;

  // 같은 문장이 여러 번 터졌으면 묶어서 보여 준다.
  // 훅은 조건부 return보다 먼저 호출해야 하므로 result가 없을 때도 안전하게 계산한다.
  const bombs = useMemo(() => {
    const counts = new Map<string, { text: string; explain: string; count: number }>();
    for (const entry of result?.bombs ?? []) {
      const current = counts.get(entry.text) ?? {
        text: entry.text,
        explain: entry.explain,
        count: 0,
      };
      current.count += 1;
      counts.set(entry.text, current);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [result?.bombs]);

  if (!result) return null;
  const top = result.ranking[0]?.score ?? 0;

  return (
    <div className="result">
      <h2 className="result-title">
        {result.reason === "target" ? "목표 점수 달성!" : "게임 끝!"}
      </h2>
      <p className="result-winner">🏆 {result.winners.join(", ")}</p>

      <ol className="ranking">
        {result.ranking.map((entry, index) => (
          <li key={entry.id} className={entry.score === top ? "is-top" : ""}>
            <span className="rank-no">{index + 1}</span>
            <span className="rank-name">{entry.name}</span>
            <span className="rank-score">{entry.score}점</span>
          </li>
        ))}
      </ol>

      <section className="bomb-note">
        <div className="bomb-note-head">
          <h3>💣 이번 판에 터진 폭탄 {bombs.length}개</h3>
          {bombs.length > 0 && (
            <button type="button" className="ghost small" onClick={() => downloadBombReport(bombs)}>
              오답노트 내려받기
            </button>
          )}
        </div>
        {bombs.length === 0 ? (
          <p className="muted">폭탄을 하나도 밟지 않았어요. 대단해요!</p>
        ) : (
          <ul>
            {bombs.map((bomb) => (
              <li key={bomb.text}>
                <p className="bomb-text">
                  {bomb.text}
                  {bomb.count > 1 && <span className="bomb-count">{bomb.count}번</span>}
                </p>
                {bomb.explain && <p className="bomb-explain">{bomb.explain}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="result-actions">
        {state.isHost && (
          <button type="button" className="primary" onClick={() => send({ type: "rematch" })}>
            같은 친구들과 한 판 더
          </button>
        )}
        <button type="button" className="ghost" onClick={onLeave}>
          나가기
        </button>
      </div>
    </div>
  );
}

export default function StudentView({ state, send, onLeave, spectator = false }: Props) {
  const openSlot = state.grid.find((slot) => slot.faceUp);
  const revealRatio = useCountdown(state.revealEndsAt, state.serverTime);
  // 카드를 연 뒤 자동 공개까지 남은 시간. 방 전체가 같은 값을 보고 함께 기다린다.
  const judgeRatio = useCountdown(state.judgeEndsAt, state.serverTime);
  const judgeSecondsLeft = Math.max(0, Math.ceil(judgeRatio * state.config.judgeSeconds));
  const wasMyTurn = useRef(false);
  const previousPhase = useRef(state.phase);

  // 한 사람이 카드를 열면 서버 상태가 방 전체에 전파된다. 모든 기기에서 같은 타이밍에
  // 카드·안전·폭탄 효과음을 재생해 함께 게임하는 느낌을 준다.
  useEffect(() => {
    const previous = previousPhase.current;
    if (previous !== state.phase) {
      if (state.phase === "judge") playSound("card");
      if (state.phase === "reveal") playSound(openSlot?.safe ? "safe" : "bomb");
      if (state.phase === "finished") playSound("win");
    }
    previousPhase.current = state.phase;
  }, [openSlot?.safe, state.phase]);

  // 태블릿에서 자기 차례가 오면 진동으로 알려 준다.
  useEffect(() => {
    if (state.isMyTurn && !wasMyTurn.current && state.phase === "roll")
      navigator.vibrate?.(120);
    wasMyTurn.current = state.isMyTurn;
  }, [state.isMyTurn, state.phase]);

  if (state.phase === "finished")
    return (
      <div className="game">
        <ResultView state={state} send={send} onLeave={onLeave} />
      </div>
    );

  if (state.phase === "lobby") {
    const ready = state.players.filter((player) => player.connected).length;
    return (
      <div className="game">
        <div className="lobby">
          <p className="lobby-room">{state.label || state.room}</p>
          <h2 className="lobby-title">친구를 기다리고 있어요</h2>
          <p className="lobby-count">
            {ready}명 / 최소 {state.minPlayers}명 · 최대 {state.maxPlayers}명
          </p>
          {spectator && (
            <p className="spectator-banner">👀 선생님 관전 중 · 학생들이 모이는 모습을 보고 있어요.</p>
          )}
          <ul className="lobby-players">
            {state.players.map((player) => (
              <li key={player.id} className={player.sameDevice ? "is-me" : ""}>
                {player.name}
                {player.isMe && !state.sharedDevice ? " (나)" : ""}
              </li>
            ))}
          </ul>
          {state.sharedDevice && (
            <p className="field-hint">이 기기로 함께 참여하는 친구는 노란색으로 보여요.</p>
          )}
          <p className="lobby-config">{describeConfig(state.config)}</p>
          {state.isHost ? (
            <button
              type="button"
              className="primary big"
              disabled={ready < state.minPlayers}
              onClick={() => send({ type: "start" })}
            >
              {ready < state.minPlayers ? `${state.minPlayers}명이 모여야 시작해요` : "게임 시작!"}
            </button>
          ) : (
            <p className="muted">
              {spectator
                ? "학생들이 모이고 게임이 시작되기를 기다리는 중이에요."
                : "선생님이 시작하기를 기다리는 중이에요."}
            </p>
          )}
          <button type="button" className="ghost small" onClick={onLeave}>
            나가기
          </button>
        </div>
      </div>
    );
  }

  // 한 기기를 돌려 쓰는 모둠에서는 "내 차례"가 아니라 누구 차례인지가 중요하다.
  const turnBanner = !state.isMyTurn
    ? `${state.currentPlayerName} 차례`
    : state.sharedDevice
      ? `${state.currentPlayerName} 차례예요`
      : "내 차례!";

  return (
    <div className="game">
      <header className="game-head">
        <div className="game-head-left">
          <span className="room-tag">{state.label || state.room}</span>
          <span className="phase-tag">{PHASE_LABELS[state.phase]}</span>
        </div>
        <span className="deck-tag">남은 카드 {state.cardsRemaining}장</span>
      </header>

      <Scoreboard state={state} />

      {spectator && (
        <p className="spectator-banner">👀 선생님 관전 모드 · 이 방의 게임 화면을 함께 보고 있어요.</p>
      )}

      {state.sharedDevice && state.isMyTurn && state.phase === "roll" && (
        <p className="handover">🔄 {state.currentPlayerName}에게 기기를 넘겨 주세요</p>
      )}

      <div className={`turn-banner ${state.isMyTurn ? "is-mine" : ""}`}>
        <strong>{turnBanner}</strong>
        {state.phase !== "roll" && state.streakTarget > 0 && (
          <span className="turn-progress">
            {/* 카드를 고르는 동안에도 몇이 나왔는지 계속 보이게 둔다. */}
            <span className="turn-dice" aria-label={`주사위 ${state.dice}`}>
              🎲 {state.dice}
            </span>
            {state.streak} / {state.streakTarget}장 연속 성공
          </span>
        )}
      </div>

      {/* 주사위 단계 */}
      {state.phase === "roll" && (
        <div className="stage stage-roll">
          <Dice value={state.dice} rolling={false} />
          {state.isMyTurn ? (
            <button
              type="button"
              className="primary big"
              onClick={() => {
                playSound("dice");
                send({ type: "roll_dice" });
              }}
            >
              주사위 굴리기
            </button>
          ) : (
            <p className="muted">{state.currentPlayerName}이(가) 주사위를 굴리고 있어요.</p>
          )}
        </div>
      )}

      {/* 카드 공개 · 자동 판정 단계 */}
      {(state.phase === "judge" || state.phase === "reveal") && openSlot && (
        <div className="stage">
          <CardStage slot={openSlot} phase={state.phase} />
          {state.phase === "reveal" && (
            <div className="reveal-bar">
              <span style={{ transform: `scaleX(${revealRatio})` }} />
            </div>
          )}
          {state.phase === "judge" && (
            <div className="judge-countdown" role="timer" aria-live="off">
              <p className="judge-countdown-room">👀 방 친구 모두에게 공개 중</p>
              <p className="judge-countdown-hint">모둠 친구들과 정답을 예상해 보세요!</p>
              <div className="judge-countdown-bar">
                <span style={{ transform: `scaleX(${judgeRatio})` }} />
              </div>
              <p className="judge-countdown-number">⏳ {judgeSecondsLeft}초 후 자동 판정</p>
            </div>
          )}
        </div>
      )}

      {/* 턴 결과 */}
      {state.phase === "turnEnd" && state.turnResult && (
        <div className={`stage turn-result ${state.turnResult.success ? "is-safe" : "is-bomb"}`}>
          <p className="turn-result-title">
            {state.turnResult.success ? "🎉 성공!" : "💥 폭탄!"}
          </p>
          <p className="turn-result-detail">
            {state.turnResult.playerName} · {state.turnResult.cleared}/{state.turnResult.target}장 ·{" "}
            <strong>+{state.turnResult.gained}점</strong>
          </p>
        </div>
      )}

      {/* 카드 격자 */}
      <div
        className={`grid grid-${state.config.gridSize}`}
        aria-label="카드 격자"
      >
        {state.grid.map((slot) => {
          const isOpen = Boolean(slot.faceUp);
          const pickable = state.phase === "pick" && state.isMyTurn && !slot.empty;
          return (
            <button
              key={slot.index}
              type="button"
              className={[
                "card",
                slot.empty ? "is-empty" : "",
                isOpen ? "is-open" : "",
                pickable ? "is-pickable" : "",
              ].join(" ")}
              disabled={!pickable}
              onClick={() => {
                playSound("tap");
                send({ type: "pick_card", index: slot.index });
              }}
              aria-label={slot.empty ? "빈 자리" : isOpen ? slot.text : "뒤집힌 카드"}
            >
              {slot.empty ? "" : isOpen ? "🔍" : "?"}
            </button>
          );
        })}
      </div>

      {state.phase === "pick" && !state.isMyTurn && (
        <p className="muted center">{state.currentPlayerName}이(가) 카드를 고르고 있어요.</p>
      )}
    </div>
  );
}
