import React, { useState, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ChatAnswer, Cents } from '@settle/shared';
import { useChat, useSnapshot } from '../api/queries';
import { BalanceChart } from './BalanceChart';
import { formatUsd } from '../lib/format';
import { TEST_IDS } from '../testids';

export interface CopilotMessage {
  id: string;
  sender: 'user' | 'copilot';
  text: string;
  answer?: ChatAnswer;
  error?: string;
  failedQuestion?: string;
}

export const SUGGESTED_PROMPTS = [
  { text: 'Can I cover the next payroll?', testId: TEST_IDS.chatSuggestion1 },
  { text: 'What if I buy $3,000 of stock on Monday?', testId: TEST_IDS.chatSuggestion2 },
  { text: 'Which invoice should I chase first?', testId: TEST_IDS.chatSuggestion3 },
];

export interface CopilotProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Copilot: React.FC<CopilotProps> = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'msg_welcome',
      sender: 'copilot',
      text: 'Hello. I am Settle Copilot. Ask me about upcoming payroll obligations, scenario simulations, or invoice prioritization.',
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: snapshot } = useSnapshot();
  const reserveThreshold: Cents | undefined = snapshot?.business.reserveThreshold;

  const chatMutation = useChat();

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, chatMutation.isPending]);

  const handleSend = (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || chatMutation.isPending) return;

    const userMsg: CopilotMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');

    chatMutation.mutate(
      { question: trimmed },
      {
        onSuccess: (data) => {
          const copilotMsg: CopilotMessage = {
            id: `copilot_${Date.now()}`,
            sender: 'copilot',
            text: data.text,
            answer: data,
          };
          setMessages((prev) => [...prev, copilotMsg]);
        },
        onError: (err) => {
          const errorMsg: CopilotMessage = {
            id: `error_${Date.now()}`,
            sender: 'copilot',
            text: 'I was unable to retrieve an answer at this time.',
            error: err.message || 'Request failed',
            failedQuestion: trimmed,
          };
          setMessages((prev) => [...prev, errorMsg]);
        },
      },
    );
  };

  const handleRetry = (failedQuestion?: string) => {
    if (failedQuestion) {
      handleSend(failedQuestion);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-slate-900/20 backdrop-blur-[1px] z-40 transition-opacity" />
        <Dialog.Content
          className="fixed top-0 right-0 h-full w-[540px] max-w-full bg-surface border-l border-border shadow-none z-50 flex flex-col justify-between p-6 focus:outline-none"
          aria-describedby="copilot-description"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <Dialog.Title className="text-lg font-bold text-ink">Cashflow Copilot</Dialog.Title>
              <Dialog.Description id="copilot-description" className="text-xs text-muted">
                Natural-language scenario exploration and liquidity advisory
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                data-testid={TEST_IDS.copilotClose}
                onClick={onClose}
                className="p-1 rounded text-muted hover:text-ink hover:bg-slate-100 transition-colors"
                aria-label="Close copilot"
              >
                &times;
              </button>
            </Dialog.Close>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto py-4 space-y-4">
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}
                >
                  <div
                    className={`max-w-[90%] rounded-lg p-3 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-accent text-white font-medium'
                        : 'bg-slate-50 border border-border text-ink'
                    }`}
                  >
                    {/* Verbatim text node (no markdown injection) */}
                    <p className="whitespace-pre-wrap">{msg.text}</p>

                    {/* Error retry option */}
                    {msg.error && (
                      <div data-testid={TEST_IDS.copilotError} className="mt-2 text-xs text-red-600">
                        <span>{msg.error}</span>
                        <button
                          type="button"
                          data-testid={TEST_IDS.copilotRetry}
                          onClick={() => handleRetry(msg.failedQuestion)}
                          className="ml-2 underline font-semibold text-red-700 hover:text-red-900"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Tool calls disclosure */}
                  {!isUser && msg.answer?.toolCalls && msg.answer.toolCalls.length > 0 && (
                    <div
                      data-testid={TEST_IDS.copilotToolCalls}
                      className="w-full max-w-[95%] text-xs"
                    >
                      <details className="border border-border rounded bg-slate-50/50 p-2 text-muted">
                        <summary className="cursor-pointer font-medium hover:text-ink">
                          Tool calls ({msg.answer.toolCalls.length})
                        </summary>
                        <div className="overflow-x-auto mt-2">
                          <table className="w-full text-left text-[11px] border-collapse font-mono">
                            <thead>
                              <tr className="border-b border-border text-slate-500">
                                <th className="py-1 px-2">Name</th>
                                <th className="py-1 px-2">Args</th>
                                <th className="py-1 px-2">Result</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {msg.answer.toolCalls.map((tc, idx) => (
                                <tr key={idx}>
                                  <td className="py-1 px-2 font-semibold text-accent">{tc.name}</td>
                                  <td className="py-1 px-2 max-w-[140px] truncate" title={JSON.stringify(tc.args)}>
                                    {JSON.stringify(tc.args)}
                                  </td>
                                  <td className="py-1 px-2 max-w-[140px] truncate" title={JSON.stringify(tc.result)}>
                                    {JSON.stringify(tc.result)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </div>
                  )}

                  {/* Attached Scenario Comparison or Forecast Chart */}
                  {!isUser && msg.answer?.comparison && (
                    <div className="w-full max-w-[95%] space-y-2 mt-2 bg-surface border border-border rounded p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-muted uppercase tracking-wider">
                          Simulation Trajectory
                        </span>
                        {msg.answer.comparison.closesGap && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-800 border border-green-200">
                            Closes the gap
                          </span>
                        )}
                      </div>

                      <BalanceChart
                        forecast={msg.answer.comparison.baseline}
                        reserve={reserveThreshold}
                        scenario={msg.answer.comparison.scenario}
                        scenarioLabel="Comparison"
                        height={180}
                        compact
                      />

                      {/* Metric row: cashCost, lowestDelta, shortfallDelta */}
                      <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1 border-t border-border">
                        <div className="p-1.5 bg-slate-50 rounded border border-border">
                          <span className="text-[10px] text-muted block">Cash Cost</span>
                          <span className="font-semibold tabular text-ink">
                            {formatUsd(msg.answer.comparison.cashCost)}
                          </span>
                        </div>
                        <div className="p-1.5 bg-slate-50 rounded border border-border">
                          <span className="text-[10px] text-muted block">Lowest Δ</span>
                          <span className="font-semibold tabular text-green-700">
                            {msg.answer.comparison.lowestDelta > 0
                              ? `+${formatUsd(msg.answer.comparison.lowestDelta)}`
                              : formatUsd(msg.answer.comparison.lowestDelta)}
                          </span>
                        </div>
                        <div className="p-1.5 bg-slate-50 rounded border border-border">
                          <span className="text-[10px] text-muted block">Shortfall Δ</span>
                          <span className="font-semibold tabular text-ink">
                            {formatUsd(msg.answer.comparison.shortfallDelta)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isUser && !msg.answer?.comparison && msg.answer?.forecast && (
                    <div className="w-full max-w-[95%] space-y-2 mt-2 bg-surface border border-border rounded p-3">
                      <span className="text-xs font-semibold text-muted uppercase tracking-wider block">
                        Projected Liquidity Trajectory
                      </span>
                      <BalanceChart
                        forecast={msg.answer.forecast}
                        reserve={reserveThreshold}
                        height={180}
                        compact
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Thinking Indicator */}
            {chatMutation.isPending && (
              <div
                data-testid={TEST_IDS.copilotThinking}
                className="flex items-center gap-2 p-3 bg-slate-50 border border-border rounded-lg text-xs text-muted animate-pulse"
              >
                <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                <span>Copilot is analyzing ledger and running simulation...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Footer: Suggested Prompts & Chat Input */}
          <div className="pt-3 border-t border-border space-y-3">
            {/* Suggested Prompt Chips */}
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Suggested Prompts
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p.testId}
                    type="button"
                    data-testid={p.testId}
                    onClick={() => handleSend(p.text)}
                    disabled={chatMutation.isPending}
                    className="px-2.5 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 border border-border text-ink text-left disabled:opacity-50 transition-colors"
                  >
                    {p.text}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Row */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend(inputValue);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                data-testid={TEST_IDS.copilotInput}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about payroll, cash reserves, or customer risks..."
                disabled={chatMutation.isPending}
                className="flex-1 px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
              />
              <button
                type="submit"
                data-testid={TEST_IDS.copilotSend}
                disabled={!inputValue.trim() || chatMutation.isPending}
                className="px-4 py-2 text-sm font-semibold rounded bg-accent text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
