// One React hook that owns all app data and every way to change it.
// Screens call these actions; the hook saves to localStorage after each change.

import { useEffect, useState } from "react";
import { dayKey, emptyData, loadData, makeId, saveData, type AppData } from "./storage";
import { isDue, newSchedule, rate, State, type Grade, type Schedule } from "./scheduler";
import {
  capSchedule,
  daysUntilExam,
  finalDaysStart,
  isFinalDays,
  newCardsAllowedToday,
  startOfDay,
} from "./exam";
import type { Card, Deck, Profile, ReviewLogEntry, ReviewResult } from "./types";
import type { Pack } from "./packs";

export function useAppData() {
  const [data, setData] = useState<AppData>(loadData);
  // True if the last save failed (e.g. the browser's storage is full).
  const [saveFailed, setSaveFailed] = useState(false);

  // Write to localStorage whenever the data changes, and remember if it failed.
  useEffect(() => {
    // Recording the save result is the point of this effect, so setState here is intended.
    // eslint-disable-next-line react/set-state-in-effect
    setSaveFailed(!saveData(data));
  }, [data]);

  // ---------- Decks ----------

  function addDeck(name: string) {
    const deck = { id: makeId(), name, cardIds: [] };
    setData((d) => ({ ...d, decks: [...d.decks, deck] }));
  }

  function deleteDeck(deckId: string) {
    setData((d) => {
      const deck = d.decks.find((x) => x.id === deckId);
      const cards = { ...d.cards };
      const schedules = { ...d.schedules };
      for (const cardId of deck?.cardIds ?? []) {
        delete cards[cardId];
        delete schedules[cardId];
      }
      return { ...d, decks: d.decks.filter((x) => x.id !== deckId), cards, schedules };
    });
  }

  function updateDeck(deckId: string, changes: Partial<Deck>) {
    setData((d) => ({
      ...d,
      decks: d.decks.map((deck) => (deck.id === deckId ? { ...deck, ...changes } : deck)),
    }));
  }

  // Exam date as "2026-12-01", or undefined to turn exam mode off.
  function setExamDate(deckId: string, examDate: string | undefined) {
    updateDeck(deckId, { examDate });
  }

  // Archived decks are kept but left out of studying and due counts.
  function setArchived(deckId: string, archived: boolean) {
    // Un-archiving also ends exam mode, so the "exam is over" question doesn't come back.
    updateDeck(deckId, archived ? { archived: true } : { archived: false, examDate: undefined });
  }

  // Adds a built-in pack as a new deck, giving each card a fresh id.
  function addPack(pack: Pack) {
    const now = new Date();
    const newCards = pack.cards.map((card) => ({ ...card, id: makeId() }) as Card);
    const deck = {
      id: makeId(),
      name: pack.name,
      cardIds: newCards.map((c) => c.id),
      packId: pack.id,
    };
    setData((d) => {
      const cards = { ...d.cards };
      const schedules = { ...d.schedules };
      for (const card of newCards) {
        cards[card.id] = card;
        schedules[card.id] = newSchedule(now);
      }
      return { ...d, decks: [...d.decks, deck], cards, schedules };
    });
  }

  // ---------- Cards ----------

  function addFlashcard(deckId: string, front: string, back: string, choice: boolean) {
    const card: Card = { id: makeId(), type: "flashcard", front, back, choice };
    setData((d) => ({
      ...d,
      decks: d.decks.map((deck) =>
        deck.id === deckId ? { ...deck, cardIds: [...deck.cardIds, card.id] } : deck,
      ),
      cards: { ...d.cards, [card.id]: card },
      schedules: { ...d.schedules, [card.id]: newSchedule() },
    }));
  }

  // Switches a flashcard between multiple choice and Show answer.
  function setFlashcardChoice(cardId: string, choice: boolean) {
    setData((d) => {
      const card = d.cards[cardId];
      if (card.type !== "flashcard") return d;
      return { ...d, cards: { ...d.cards, [cardId]: { ...card, choice } } };
    });
  }

  function deleteCard(cardId: string) {
    setData((d) => {
      const cards = { ...d.cards };
      const schedules = { ...d.schedules };
      delete cards[cardId];
      delete schedules[cardId];
      return {
        ...d,
        decks: d.decks.map((deck) => ({
          ...deck,
          cardIds: deck.cardIds.filter((id) => id !== cardId),
        })),
        cards,
        schedules,
      };
    });
  }

  function deckOf(cardId: string): Deck | undefined {
    return data.decks.find((deck) => deck.cardIds.includes(cardId));
  }

  // The backs of the other flashcards in the same deck (wrong options for
  // multiple-choice flashcards).
  function otherBacks(cardId: string): string[] {
    const ids = deckOf(cardId)?.cardIds ?? [];
    return ids
      .filter((id) => id !== cardId)
      .map((id) => data.cards[id])
      .flatMap((card) => (card.type === "flashcard" ? [card.back] : []));
  }

  // ---------- Reviewing ----------

  // Saves the rating, adds a line to the review log, and returns the card's
  // new schedule. In practice mode the schedule is left as it was.
  function reviewCard(
    cardId: string,
    grade: Grade,
    result: ReviewResult,
    durationMs: number,
    practice: boolean,
    now: Date,
  ): Schedule {
    const before = data.schedules[cardId];
    let next = practice ? before : rate(before, grade, now);

    // Exam mode: don't schedule past the interval cap.
    const deck = deckOf(cardId);
    if (!practice && deck?.examDate) {
      const daysLeft = daysUntilExam(deck.examDate, now);
      if (daysLeft >= 0) next = capSchedule(next, daysLeft, now);
    }

    const entry = logEntry(cardId, now, result, grade, durationMs, practice);
    const today = dayKey(now);
    setData((d) => ({
      ...d,
      schedules: { ...d.schedules, [cardId]: next },
      reviewDays: d.reviewDays.includes(today) ? d.reviewDays : [...d.reviewDays, today],
      reviewLog: [...d.reviewLog, entry],
    }));
    return next;
  }

  // Skipping: logged, but the card isn't cleared and stays due.
  function skipCard(cardId: string, durationMs: number, practice: boolean, now: Date) {
    const entry = logEntry(cardId, now, "skipped", null, durationMs, practice);
    setData((d) => ({ ...d, reviewLog: [...d.reviewLog, entry] }));
  }

  function logEntry(
    cardId: string,
    now: Date,
    result: ReviewResult,
    grade: Grade | null,
    durationMs: number,
    practice: boolean,
  ): ReviewLogEntry {
    return {
      at: now.toISOString(),
      cardId,
      deckId: deckOf(cardId)?.id ?? "",
      cardType: data.cards[cardId].type,
      result,
      grade,
      stateBefore: STATE_NAMES[data.schedules[cardId].state],
      durationMs: Math.round(durationMs),
      ...(practice ? { practice: true } : {}),
    };
  }

  // ---------- What to study ----------

  // Cards in one deck that are due. Usually that's "the due date has come",
  // but exam decks have extra rules (see exam.ts).
  function dueInDeck(deck: Deck, now: Date): string[] {
    if (deck.archived) return [];
    const daysLeft = deck.examDate ? daysUntilExam(deck.examDate, now) : undefined;
    const examAhead = daysLeft !== undefined && daysLeft >= 0;

    let newAllowed = Infinity;
    if (examAhead) {
      const newLeft = deck.cardIds.filter((id) => data.schedules[id]?.state === State.New).length;
      newAllowed = newCardsAllowedToday(newLeft, newIntroducedToday(deck, now), daysLeft);
    }
    const finalDaysFrom =
      examAhead && isFinalDays(daysLeft) ? finalDaysStart(deck.examDate!) : undefined;

    const due: string[] = [];
    for (const id of deck.cardIds) {
      const schedule = data.schedules[id];
      if (!schedule) continue;
      if (schedule.state === State.New) {
        if (newAllowed > 0 && isDue(schedule, now)) {
          due.push(id);
          newAllowed--;
        }
      } else if (isDue(schedule, now)) {
        due.push(id);
      } else if (finalDaysFrom && (!schedule.last_review || schedule.last_review < finalDaysFrom)) {
        due.push(id); // final days before the exam: everything comes up once
      }
    }
    return due;
  }

  // How many new cards from this deck were seen for the first time today.
  function newIntroducedToday(deck: Deck, now: Date): number {
    const today = startOfDay(now).toISOString();
    return data.reviewLog.filter(
      (entry) =>
        entry.deckId === deck.id &&
        entry.stateBefore === "new" &&
        entry.result !== "skipped" &&
        !entry.practice &&
        entry.at >= today,
    ).length;
  }

  // Ids of cards in the given decks that are due right now.
  function dueCardIds(deckIds: string[], now = new Date()): string[] {
    return data.decks
      .filter((deck) => deckIds.includes(deck.id))
      .flatMap((deck) => dueInDeck(deck, now));
  }

  // Cards for extra practice: everything already studied in these decks,
  // soonest due first. (Never-seen cards only if nothing has been studied yet.)
  function practiceCardIds(deckIds: string[]): string[] {
    const ids = data.decks
      .filter((deck) => deckIds.includes(deck.id) && !deck.archived)
      .flatMap((deck) => deck.cardIds)
      .filter((id) => data.schedules[id]);
    const studied = ids.filter((id) => data.schedules[id].state !== State.New);
    const pool = studied.length > 0 ? studied : ids;
    return pool.sort((a, b) => data.schedules[a].due.getTime() - data.schedules[b].due.getTime());
  }

  // When the next card in these decks becomes due (undefined if no cards).
  function nextDueDate(deckIds: string[], now = new Date()): Date | undefined {
    const decks = data.decks.filter((deck) => deckIds.includes(deck.id) && !deck.archived);
    const dueNow = new Set(decks.flatMap((deck) => dueInDeck(deck, now)));
    const tomorrow = new Date(startOfDay(now).getTime() + 24 * 60 * 60 * 1000);
    const times = decks
      .flatMap((deck) => deck.cardIds)
      .filter((id) => data.schedules[id] && !dueNow.has(id))
      .map((id) => {
        const due = data.schedules[id].due;
        // Not due even though the date has passed: a new card held back by
        // exam pacing. It's introduced tomorrow.
        return due <= now ? tomorrow.getTime() : due.getTime();
      });
    return times.length > 0 ? new Date(Math.min(...times)) : undefined;
  }

  // ---------- Profile and whole-data actions ----------

  function updateSettings(changes: Partial<Profile["settings"]>) {
    setData((d) => ({
      ...d,
      profile: { ...d.profile, settings: { ...d.profile.settings, ...changes } },
    }));
  }

  // Swaps in imported data (from a backup file).
  function replaceData(newData: AppData) {
    setData(newData);
  }

  function resetData() {
    setData(emptyData());
  }

  return {
    data,
    saveFailed,
    addDeck,
    deleteDeck,
    setExamDate,
    setArchived,
    addPack,
    addFlashcard,
    setFlashcardChoice,
    deleteCard,
    otherBacks,
    reviewCard,
    skipCard,
    dueCardIds,
    practiceCardIds,
    nextDueDate,
    updateSettings,
    replaceData,
    resetData,
  };
}

export type AppActions = ReturnType<typeof useAppData>;

const STATE_NAMES: Record<State, ReviewLogEntry["stateBefore"]> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};
