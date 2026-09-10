import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { Config, GradeBand, HubState, Operation, QuestionType, RoomSummary, Subject } from "./types";
import {
  DICE_OPTIONS,
  GRADE_BANDS,
  G12_INTEGRATED_NOTE,
  OPERATIONS,
  OPERATIONS_BY_BAND,
  PHASE_LABELS,
  QUESTION_TYPES,
  SCORING_OPTIONS,
  SUBJECTS,
  describeConfig,
  questionShortfall,
} from "./labels";
import { downloadBombReport, downloadTemplate, parseQuestionFile } from "./excel";
import { joinUrl } from "./gameClient";

type Props = {
  state: HubState;
  send: (message: Record<string, unknown>) => void;
  onLeave: () => void;
  notice: string;
};

/** 방 코드마다 QR 이미지를 만들어 둔다. 방이 늘거나 줄 때만 다시 만든다. */
function useQrCodes(codes: string[]) {
  const [images, setImages] = useState<Record<string, string>>({});
  const key = codes.join(",");

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      codes.map(async (code) => [
        code,
        await QRCode.toDataURL(joinUrl(code), {
          margin: 1,
          width: 320,
          color: { dark: "#0f1729", light: "#ffffff" },
        }),
      ]),
    ).then((entries) => {
      if (!cancelled) setImages(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return images;
}

function SettingsPanel({
  config,
  onApply,
  disabled,
}: {
  config: Config;
  onApply: (next: Partial<Config>) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<Config>(config);
  const allowedOps = OPERATIONS_BY_BAND[draft.gradeBand];
  // 적용된 설정 기준으로 판단한다. 초안은 아직 서버가 문제 수를 세어 주지 않았다.
  const shortfall = questionShortfall(config);

  useEffect(() => setDraft(config), [config]);

  const update = (patch: Partial<Config>) => {
    const next = { ...draft, ...patch };
    // 학년군을 바꾸면 그 학년에 없는 연산은 자동으로 걸러 준다.
    if (patch.gradeBand) {
      const allowed = OPERATIONS_BY_BAND[patch.gradeBand];
      next.operations = next.operations.filter((op) => allowed.includes(op));
      if (!next.operations.length) next.operations = allowed;
    }
    setDraft(next);
  };

  const toggleOperation = (operation: Operation) => {
    const has = draft.operations.includes(operation);
    const next = has
      ? draft.operations.filter((op) => op !== operation)
      : [...draft.operations, operation];
    update({ operations: next.length ? next : draft.operations });
  };

  const showIntegratedNote =
    draft.gradeBand === "g12" &&
    draft.questionType === "proposition" &&
    (draft.subject === "science" || draft.subject === "social");

  return (
    <section className="panel">
      <h2 className="panel-title">문제 설정</h2>

      <div className="field">
        <span className="field-label">문제 유형</span>
        <div className="chip-row">
          {QUESTION_TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`chip ${draft.questionType === option.value ? "is-on" : ""}`}
              onClick={() => update({ questionType: option.value as QuestionType })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="field-hint">
          {QUESTION_TYPES.find((item) => item.value === draft.questionType)?.hint}
        </p>
      </div>

      <div className="field">
        <span className="field-label">학년군</span>
        <div className="chip-row">
          {GRADE_BANDS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`chip ${draft.gradeBand === option.value ? "is-on" : ""}`}
              onClick={() => update({ gradeBand: option.value as GradeBand })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {draft.questionType === "arithmetic" && (
        <div className="field">
          <span className="field-label">연산 (여러 개 고를 수 있어요)</span>
          <div className="chip-row">
            {OPERATIONS.map((option) => {
              const allowed = allowedOps.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={!allowed}
                  className={`chip ${draft.operations.includes(option.value) ? "is-on" : ""}`}
                  onClick={() => toggleOperation(option.value)}
                  title={allowed ? undefined : "이 학년군에는 없는 연산이에요"}
                >
                  {option.sign} {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {draft.questionType === "proposition" && (
        <div className="field">
          <span className="field-label">과목</span>
          <div className="chip-row">
            {SUBJECTS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chip ${draft.subject === option.value ? "is-on" : ""}`}
                onClick={() => update({ subject: option.value as Subject })}
              >
                {option.label}
              </button>
            ))}
          </div>
          {showIntegratedNote && <p className="field-hint warn">{G12_INTEGRATED_NOTE}</p>}
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <span className="field-label">주사위</span>
          <div className="chip-row">
            {DICE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chip ${draft.diceMax === option.value ? "is-on" : ""}`}
                onClick={() => update({ diceMax: option.value })}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">카드 판</span>
          <div className="chip-row">
            {[9, 16].map((size) => (
              <button
                key={size}
                type="button"
                className={`chip ${draft.gridSize === size ? "is-on" : ""}`}
                onClick={() => update({ gridSize: size })}
              >
                {size === 9 ? "3×3" : "4×4"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">판정 모드</span>
        <div className="chip-row">
          <button
            type="button"
            className={`chip ${draft.judgeMode ? "is-on" : ""}`}
            onClick={() => update({ judgeMode: true })}
          >
            켜기 (권장)
          </button>
          <button
            type="button"
            className={`chip ${!draft.judgeMode ? "is-on" : ""}`}
            onClick={() => update({ judgeMode: false })}
          >
            끄기 (원본)
          </button>
        </div>
        <p className="field-hint">
          {draft.judgeMode
            ? "카드를 열면 문장을 읽고 학생이 ⭕/💣를 직접 골라요. 운이 아니라 실력으로 겨뤄요."
            : "카드를 열면 바로 결과가 나와요. 원래 보드게임과 같아요."}
        </p>
      </div>

      <div className="field-row">
        <div className="field">
          <span className="field-label">점수 방식</span>
          <div className="chip-row">
            {SCORING_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chip ${draft.scoring === option.value ? "is-on" : ""}`}
                onClick={() => update({ scoring: option.value })}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">폭탄 비율 {Math.round(draft.bombRatio * 100)}%</span>
          <input
            type="range"
            min={10}
            max={50}
            step={5}
            value={Math.round(draft.bombRatio * 100)}
            onChange={(event) => update({ bombRatio: Number(event.target.value) / 100 })}
          />
          <p className="field-hint">원본은 30%예요.</p>
        </div>
      </div>

      {shortfall && (
        <p className="shortfall">
          ⚠️ 지금 적용된 설정은 문제가 <strong>{shortfall.have}개</strong>뿐이라 시작할 수 없어요.
          {shortfall.need}개 이상 필요해요. 다른 과목·학년군을 고르거나, 카드 판을 3×3으로 줄이거나,
          엑셀로 우리 반 문제를 올려 주세요.
        </p>
      )}

      <button
        type="button"
        className="primary"
        disabled={disabled}
        onClick={() => onApply(draft)}
      >
        모든 모둠에 적용
      </button>
      {disabled && <p className="field-hint warn">진행 중인 모둠이 있어 지금은 바꿀 수 없어요.</p>}
    </section>
  );
}

function RoomCard({
  room,
  qr,
  send,
}: {
  room: RoomSummary;
  qr?: string;
  send: Props["send"];
}) {
  const [copied, setCopied] = useState(false);
  const action = (name: string) =>
    send({ type: "teacher_action", roomCode: room.code, action: name });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl(room.code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const playing = room.phase !== "lobby" && room.phase !== "finished";
  const shortfall = questionShortfall(room.config);

  return (
    <article className={`room-card ${playing ? "is-playing" : ""}`}>
      <header className="room-card-head">
        <h3>{room.label}</h3>
        <span className={`room-phase phase-${room.phase}`}>{PHASE_LABELS[room.phase]}</span>
      </header>

      <div className="room-card-body">
        <div className="room-qr">
          {qr ? <img src={qr} alt={`${room.label} 입장 QR`} /> : <div className="qr-loading" />}
          <button type="button" className="room-code" onClick={copyLink}>
            {copied ? "복사됨!" : room.code}
          </button>
        </div>

        <div className="room-info">
          <p className="room-count">
            {room.connectedCount} / {room.maxPlayers}명
            {room.connectedCount < room.minPlayers && (
              <span className="room-warn"> · {room.minPlayers}명 필요</span>
            )}
          </p>
          <ul className="room-players">
            {room.players.length === 0 && <li className="muted">아직 아무도 없어요</li>}
            {room.players.map((player) => (
              <li key={player.id} className={player.connected ? "" : "is-offline"}>
                <span className={player.isTurn ? "is-turn" : ""}>
                  {player.isTurn ? "▶ " : ""}
                  {player.name}
                </span>
                <strong>{player.score}</strong>
              </li>
            ))}
          </ul>
          {playing && (
            <p className="room-progress">
              {room.round}라운드 · 남은 카드 {room.cardsRemaining}장 · 💣 {room.bombsHit}
            </p>
          )}
          <p className="room-config">{describeConfig(room.config)}</p>
          {shortfall && (
            <p className="room-shortfall">⚠️ 문제 {shortfall.have}개 · {shortfall.need}개 필요</p>
          )}
        </div>
      </div>

      <footer className="room-card-actions">
        {room.phase === "lobby" && (
          <button
            type="button"
            className="small primary"
            disabled={room.connectedCount < room.minPlayers || Boolean(shortfall)}
            onClick={() => action("start")}
          >
            시작
          </button>
        )}
        {playing && (
          <>
            <button type="button" className="small ghost" onClick={() => action("skip_turn")}>
              턴 넘기기
            </button>
            <button type="button" className="small danger" onClick={() => action("finish")}>
              끝내기
            </button>
          </>
        )}
        {room.phase === "finished" && (
          <button type="button" className="small primary" onClick={() => action("rematch")}>
            다시 시작
          </button>
        )}
      </footer>
    </article>
  );
}

export default function TeacherView({ state, send, onLeave, notice }: Props) {
  const codes = useMemo(() => state.rooms.map((room) => room.code), [state.rooms]);
  const qrCodes = useQrCodes(codes);
  const [uploadMessage, setUploadMessage] = useState("");
  const [showQrSheet, setShowQrSheet] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const anyPlaying = state.rooms.some(
    (room) => room.phase !== "lobby" && room.phase !== "finished",
  );
  const baseConfig = state.rooms[0]?.config;

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadMessage("파일을 읽는 중이에요…");
    try {
      const { items, skipped, warnings } = await parseQuestionFile(file);
      if (items.length < 8) {
        setUploadMessage(`문제가 ${items.length}개뿐이에요. 8개 이상 필요해요.`);
        return;
      }
      // 모든 모둠이 같은 문제로 겨루도록 한 번에 올린다.
      for (const room of state.rooms)
        send({ type: "teacher_action", roomCode: room.code, action: "set_questions", items });
      const parts = [`문제 ${items.length}개를 모든 모둠에 올렸어요.`];
      if (skipped) parts.push(`${skipped}줄은 건너뛰었어요.`);
      if (warnings.length) parts.push(warnings[0]);
      setUploadMessage(parts.join(" "));
    } catch (error) {
      setUploadMessage(`파일을 읽지 못했어요: ${(error as Error).message}`);
    }
  };

  if (showQrSheet)
    return (
      <div className="qr-sheet">
        <div className="qr-sheet-head no-print">
          <h2>모둠별 입장 QR</h2>
          <div>
            <button type="button" className="ghost" onClick={() => window.print()}>
              인쇄하기
            </button>
            <button type="button" className="ghost" onClick={() => setShowQrSheet(false)}>
              닫기
            </button>
          </div>
        </div>
        <div className="qr-sheet-grid">
          {state.rooms.map((room) => (
            <div key={room.code} className="qr-sheet-item">
              <h3>{room.label}</h3>
              {qrCodes[room.code] && <img src={qrCodes[room.code]} alt={`${room.label} QR`} />}
              <p className="qr-sheet-code">{room.code}</p>
              <p className="qr-sheet-url">{joinUrl(room.code)}</p>
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="teacher">
      <header className="teacher-head">
        <div>
          <h1 className="teacher-title">선생님 화면</h1>
          <p className="teacher-sub">
            모둠 {state.rooms.length}개 / 최대 {state.hub.maxRooms}개 · 통합방 코드{" "}
            <strong>{state.hub.code}</strong>
          </p>
        </div>
        <div className="teacher-actions">
          <button type="button" className="ghost" onClick={() => setShowQrSheet(true)}>
            QR 크게 보기 · 인쇄
          </button>
          <button type="button" className="primary" onClick={() => send({ type: "start_all" })}>
            전체 시작
          </button>
          <button type="button" className="ghost" onClick={onLeave}>
            나가기
          </button>
        </div>
      </header>

      {notice && <p className="notice">{notice}</p>}

      <div className="teacher-body">
        <div className="teacher-main">
          <div className="room-grid">
            {state.rooms.map((room) => (
              <RoomCard key={room.code} room={room} qr={qrCodes[room.code]} send={send} />
            ))}
          </div>

          <div className="room-manage">
            <button
              type="button"
              className="ghost small"
              disabled={state.rooms.length >= state.hub.maxRooms}
              onClick={() => send({ type: "create_child_room" })}
            >
              + 모둠 추가
            </button>
            <button
              type="button"
              className="ghost small"
              disabled={state.rooms.length <= 1}
              onClick={() =>
                send({
                  type: "remove_child_room",
                  roomCode: state.rooms[state.rooms.length - 1].code,
                })
              }
            >
              − 마지막 모둠 빼기
            </button>
          </div>
        </div>

        <aside className="teacher-side">
          {baseConfig && (
            <SettingsPanel
              config={baseConfig}
              disabled={anyPlaying}
              onApply={(next) => send({ type: "apply_all", config: next })}
            />
          )}

          <section className="panel">
            <h2 className="panel-title">우리 반 문제 올리기</h2>
            <p className="field-hint">
              엑셀 양식을 받아 <code>문장 / 정답(O·X) / 해설</code> 세 칸을 채워 올리면 모든 모둠에
              같은 문제가 들어가요. 파일은 서버로 올라가지 않고 이 브라우저에서만 읽어요.
            </p>
            <div className="chip-row">
              <button type="button" className="ghost small" onClick={downloadTemplate}>
                엑셀 양식 내려받기
              </button>
              <button
                type="button"
                className="ghost small"
                disabled={anyPlaying}
                onClick={() => fileInput.current?.click()}
              >
                파일 올리기
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,.tsv"
              hidden
              onChange={(event) => {
                handleUpload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {uploadMessage && <p className="field-hint">{uploadMessage}</p>}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">💣 많이 터진 문제</h2>
              {state.heatmap.length > 0 && (
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => downloadBombReport(state.heatmap, "폭탄카드_학급오답노트")}
                >
                  내려받기
                </button>
              )}
            </div>
            {state.heatmap.length === 0 ? (
              <p className="muted">아직 터진 폭탄이 없어요.</p>
            ) : (
              <ol className="heatmap">
                {state.heatmap.map((entry) => (
                  <li key={entry.text}>
                    <div className="heatmap-row">
                      <span className="heatmap-text">{entry.text}</span>
                      <span className="heatmap-count">{entry.count}</span>
                    </div>
                    {entry.explain && <p className="heatmap-explain">{entry.explain}</p>}
                  </li>
                ))}
              </ol>
            )}
            <p className="field-hint">수업 마무리에 이 목록을 함께 짚어 주면 좋아요.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
