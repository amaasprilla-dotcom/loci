import { daysUntilExam } from "../exam";
import type { Deck } from "../types";

// "Exam in 12 days" countdown shown next to a deck.
export function ExamChip({ deck, now }: { deck: Deck; now: Date }) {
  if (!deck.examDate) return null;
  const days = daysUntilExam(deck.examDate, now);
  if (days < 0) return <span className="chip">Exam over</span>;
  const text = days === 0 ? "Exam today" : days === 1 ? "Exam tomorrow" : `Exam in ${days} days`;
  return <span className={`chip${days <= 2 ? " urgent" : ""}`}>{text}</span>;
}
