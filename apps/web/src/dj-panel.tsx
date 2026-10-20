import React, { useEffect, useRef, useState } from "react";
import { djMemory, djReply, job, jobAccepted, type DjMemory } from "@music/contracts";
import { api, json } from "./api";
import { describe, sourceLabel, store, stored, type DjSource } from "./model";

type Props = {
  dj: boolean;
  djSource: DjSource;
  direction: string;
  pending: boolean;
  error: string;
  blocker: string;
  chatBlocker: string;
  memory: DjMemory | null;
  nowPlaying: { title: string; artist: string | null } | null;
  onMemory: (memory: DjMemory) => void;
  onStart: (direction: string) => void;
  onFollow: (direction: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onSetup: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

const starters = ["Surprise me", "Something calm to focus to", "More energy", "Songs I haven't heard yet"];
const interviewMe = "Interview me about my taste";
const endInterview = "That's enough questions";
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new Error("Cancelled"));
    }, { once: true });
  });

// The DJ's half of the app: talk to it, let it interview you, start and steer the music.
export function DjPanel(props: Props) {
  const [draft, setDraft] = useState("");
  // Your message while the DJ answers. An empty string is the start of an interview.
  const [sending, setSending] = useState<string | null>(null);
  const [chatError, setChatError] = useState("");
  const [interviewing, setInterviewingState] = useState(() => stored("dj-interviewing") === "1");
  const log = useRef<HTMLOListElement>(null);
  const abort = useRef<AbortController | null>(null);
  const follow = useRef(props.onFollow);
  follow.current = props.onFollow;
  const setInterviewing = (value: boolean) => {
    setInterviewingState(value);
    store("dj-interviewing", value ? "1" : "0");
  };
  const messages = props.memory?.conversation ?? [];

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages.length, sending]);

  const talk = async (text: string, mode: "chat" | "interview", starting = false) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setSending(text);
    setChatError("");
    try {
      const accepted = await api("/dj/messages", jobAccepted, {
        ...json({ text, mode, djOn: props.dj || starting, starting, nowPlaying: props.nowPlaying }),
        signal: controller.signal,
      });
      for (;;) {
        await wait(1000, controller.signal);
        const state = await api(`/jobs/${accepted.jobId}`, job, { signal: controller.signal });
        if (state.status === "failed" || state.status === "cancelled") throw new Error(state.error?.message || "The DJ didn't answer. Try again.");
        if (state.status !== "succeeded") continue;
        const reply = djReply.parse(state.result);
        props.onMemory(reply.memory);
        if (mode === "interview" && reply.interviewDone) setInterviewing(false);
        if (reply.steer && !starting) follow.current(reply.steer);
        return;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setChatError(describe(error));
      if (text) setDraft((current) => current || text);
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setSending(null);
      }
    }
  };
  const submit = (text: string) => {
    const value = text.trim().slice(0, 1000);
    if (!value || sending !== null) return;
    setDraft("");
    if (interviewing) void talk(value, "interview");
    else if (!props.dj) {
      // The music starts right away; the DJ answers in the conversation meanwhile.
      props.onStart(value);
      if (!props.chatBlocker) void talk(value, "chat", true);
    } else void talk(value, "chat");
  };
  const choose = (text: string) => {
    if (text === interviewMe) {
      setInterviewing(true);
      void talk("", "interview");
    } else if (text === endInterview) setInterviewing(false);
    else if (!props.dj && !interviewing && starters.includes(text)) props.onStart(text === "Surprise me" ? "" : text);
    else submit(text);
  };
  const startOver = async () => {
    abort.current?.abort();
    setInterviewing(false);
    try {
      props.onMemory(await api("/dj/conversation", djMemory, { method: "DELETE" }));
    } catch (error) {
      setChatError(describe(error));
    }
  };

  const lastDj = [...messages].reverse().find((message) => message.role === "dj");
  const lastIsDj = messages.at(-1)?.role === "dj";
  const replies = lastIsDj ? (lastDj?.suggestions ?? []) : [];
  const chips =
    sending !== null ? [] : interviewing ? [...replies, endInterview] : props.dj ? [...(replies.length ? replies : ["Something calmer", "More energy", "Surprise me"]), interviewMe] : [...starters, interviewMe];
  // Talking needs Codex; starting the music also needs the DJ's source to be ready.
  const blocked = interviewing || props.dj ? Boolean(props.chatBlocker) : Boolean(props.blocker);
  const chipBlocked = (chip: string) => {
    if (chip === endInterview) return false;
    const talks = chip === interviewMe || interviewing || props.dj;
    return Boolean(talks ? props.chatBlocker : props.blocker);
  };
  const submitLabel = interviewing ? "Answer" : props.dj ? "Send" : "Start the DJ";

  return (
    <section className="dj-panel card booth" aria-labelledby="dj-heading">
      <div className="sticker" aria-hidden="true">
        <span>{props.dj ? "DJ on!" : "AI DJ"}</span>
      </div>
      <div className="dj-head">
        <div className="eyebrow">YOUR AI DJ</div>
        <h1 id="dj-heading" className="booth-heading">
          {props.dj ? (
            <>
              <span className="live-dot" aria-hidden="true" />
              The DJ is <em>on</em>
            </>
          ) : (
            <>
              What should we <em>listen</em> to?
            </>
          )}
        </h1>
        <p className="subtle">
          {props.dj ? (
            <>
              Picking from {sourceLabel[props.djSource]}
              {props.direction ? (
                <>
                  {" "}
                  · you asked for <q>{props.direction}</q>
                </>
              ) : (
                " · following your taste"
              )}
            </>
          ) : (
            `Tell the DJ a mood, an artist or a moment. It finds the music on ${sourceLabel[props.djSource]} and keeps it going.`
          )}
        </p>
        {props.dj && (
          <button className="secondary-button dj-stop" onClick={props.onStop}>
            Stop DJ
          </button>
        )}
      </div>

      <ol className="chat-log" ref={log} aria-label="Conversation with the DJ" aria-live="polite">
        {!messages.length && (
          <li className="bubble dj">
            Hi, I'm your DJ. Tell me what you'd like to hear and I'll start the music. Or let me interview you about your taste, so I stop guessing.
          </li>
        )}
        {messages.map((message) => (
          <li key={message.id} className={`bubble ${message.role}`}>
            <span className="sr-only">{message.role === "dj" ? "DJ: " : "You: "}</span>
            {message.text}
          </li>
        ))}
        {sending !== null && (
          <>
            {sending && <li className="bubble you">{sending}</li>}
            <li className="bubble dj typing">
              <span className="spinner" aria-hidden="true" /> The DJ is {sending ? "replying" : "thinking of a question"}…
            </li>
          </>
        )}
        {/* Quick replies sit at the end of the conversation, so they scroll with it. */}
        {chips.length > 0 && (
          <li className="suggestions" aria-label={interviewing ? "Quick answers" : "Ideas"}>
            {chips.map((chip) => (
              <button key={chip} className="chip" disabled={chipBlocked(chip)} onClick={() => choose(chip)}>
                {chip}
              </button>
            ))}
          </li>
        )}
      </ol>

      <form
        className="ask"
        onSubmit={(event) => {
          event.preventDefault();
          if (!props.dj && !interviewing && !draft.trim()) props.onStart("");
          else submit(draft);
        }}
      >
        <label htmlFor="ask" className="sr-only">
          {interviewing ? "Your answer" : props.dj ? "Talk to the DJ" : "What you'd like to hear"}
        </label>
        <input
          id="ask"
          value={draft}
          maxLength={1000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={interviewing ? "Your answer…" : props.dj ? "Talk to the DJ: calmer, more guitar, what you love…" : "Late-night jazz, something like Khruangbin…"}
        />
        <button className="primary-button" disabled={blocked || sending !== null || (!draft.trim() && (props.dj || interviewing))}>
          {submitLabel}
        </button>
      </form>

      {props.pending && (
        <p className="dj-status" role="status">
          <span className="spinner" aria-hidden="true" />
          {props.djSource === "youtube" ? "The DJ is picking tracks and finding them on YouTube…" : "The DJ is choosing from your collection…"}{" "}
          <button className="inline-button" onClick={props.onCancel}>
            Cancel
          </button>
        </p>
      )}
      {props.error && (
        <p className="error-text" role="alert">
          {props.error}{" "}
          {props.dj && !props.pending && (
            <button className="inline-button" onClick={props.onRetry}>
              Try again
            </button>
          )}
        </p>
      )}
      {chatError && (
        <p className="error-text" role="alert">
          The DJ didn't answer: {chatError}
        </p>
      )}
      {(props.dj || interviewing ? props.chatBlocker : props.blocker) && (
        <div className="blocker" role="note">
          <p>{props.dj || interviewing ? props.chatBlocker : props.blocker}</p>
          <button className="inline-button" onClick={props.onSetup}>
            How to fix this
          </button>
        </div>
      )}
      {messages.length > 0 && sending === null && (
        <button className="text-button start-over" onClick={() => void startOver()}>
          Clear the conversation
        </button>
      )}
    </section>
  );
}
