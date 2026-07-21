// @ts-nocheck
"use client";

import React, { useState, useMemo } from "react";
import { HelpCircle, Send } from "lucide-react";
import Banner from "./chat/Banner";

/**
 * QuestionDialog — renders the agent's `ask_questions` request (the baked-in
 * clarification tool). Supports free-text and multiple-choice (single/multi)
 * questions. On submit it hands back answers keyed by question id; the caller
 * sends a `question_response` over the WebSocket, unblocking the agent.
 */
export default function QuestionDialog({ questionRequest, onSubmit }) {
  const questions = questionRequest?.questions || [];
  const [answers, setAnswers] = useState({});

  const setText = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));
  const setSingle = (id, label) => setAnswers((a) => ({ ...a, [id]: label }));
  const toggleMulti = (id, label) =>
    setAnswers((a) => {
      const cur = Array.isArray(a[id]) ? a[id] : [];
      return { ...a, [id]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
    });

  const complete = useMemo(
    () =>
      questions.every((q) => {
        const v = answers[q.id];
        if (q.kind === "multi") return Array.isArray(v) && v.length > 0;
        return v !== undefined && String(v).trim() !== "";
      }),
    [questions, answers]
  );

  if (!questionRequest || !questions.length) return null;

  return (
    <Banner tone="info">
      <h4 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-primary">
        <HelpCircle size={15} /> The agent needs your input
      </h4>
      <div className="flex flex-col gap-3.5">
        {questions.map((q) => (
          <div key={q.id}>
            {q.header ? (
              <div className="mb-1 inline-block rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {q.header}
              </div>
            ) : null}
            <div className="mb-1.5 text-[13px] font-medium">{q.question}</div>

            {q.kind === "text" ? (
              <textarea
                rows={2}
                value={answers[q.id] || ""}
                onChange={(e) => setText(q.id, e.target.value)}
                placeholder="Type your answer…"
                className="w-full resize-y rounded-lg border border-border bg-background p-2 text-[13px] outline-none focus:border-primary"
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {(q.options || []).map((opt) => {
                  const selected =
                    q.kind === "multi"
                      ? Array.isArray(answers[q.id]) && answers[q.id].includes(opt.label)
                      : answers[q.id] === opt.label;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => (q.kind === "multi" ? toggleMulti(q.id, opt.label) : setSingle(q.id, opt.label))}
                      className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      <span className="font-medium">{opt.label}</span>
                      {opt.description ? (
                        <span className="mt-0.5 text-[11.5px] text-muted-foreground">{opt.description}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          disabled={!complete}
          onClick={() => onSubmit(answers)}
          className="flex items-center gap-1.5 rounded-[9px] bg-primary px-3.5 py-[7px] text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={14} /> Send answer
        </button>
      </div>
    </Banner>
  );
}
