// One React hook that owns all app data and every way to change it.
// Screens call these actions; the hook saves to localStorage after each change.

import { useEffect, useState } from "react";
import { dayKey, emptyData, loadData, makeId, saveData, type AppData } from "./storage";
import { isDue, newSchedule, rate, State, type Grade, type Schedule } from "./scheduler";
import type { Card, ReviewLogEntry, ReviewResult } from "./types";
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

  function addFlashcard(deckId: string, front: string, back: string) {
    const card: Card = { id: makeId(), type: "flashcard", front, back };
    setData((d) => ({
      ...d,
      decks: d.decks.map((deck) =>
        deck.id === deckId ? { ...deck, cardIds: [...deck.cardIds, card.id] } : deck,
      ),
      cards: { ...d.cards, [card.id]: card },
      schedules: { ...d.schedules, [card.id]: newSchedule() },
    }));
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

  // Saves the rating, adds a line to the review log, and returns the card's new schedule.
  function reviewCard(
    cardId: string,
    grade: Grade,
    result: ReviewResult,
    durationMs: number,
  ): Schedule {
    const before = data.schedules[cardId];
    const next = rate(before, grade);
    const now = new Date();
    const today = dayKey(now);
    const logEntry: ReviewLogEntry = {
      at: now.toISOString(),
      cardId,
      deckId: data.decks.find((deck) => deck.cardIds.includes(cardId))?.id ?? "",
      cardType: data.cards[cardId].type,
      result,
      grade,
      stateBefore: STATE_NAMES[before.state],
      durationMs: Math.round(durationMs),
    };
    setData((d) => ({
      ...d,
      schedules: { ...d.schedules, [cardId]: next },
      reviewDays: d.reviewDays.includes(today) ? d.reviewDays : [...d.reviewDays, today],
      reviewLog: [...d.reviewLog, logEntry],
    }));
    return next;
  }

  // Swaps in imported data (from a backup file).
  function replaceData(newData: AppData) {
    setData(newData);
  }

  function resetData() {
    setData(emptyData());
  }

  // Ids of cards in the given decks that are due right now.
  function dueCardIds(deckIds: string[], now = new Date()): string[] {
    return data.decks
      .filter((deck) => deckIds.includes(deck.id))
      .flatMap((deck) => deck.cardIds)
      .filter((id) => data.schedules[id] && isDue(data.schedules[id], now));
  }

  // The earliest due date among the cards in these decks (undefined if no cards).
  function nextDueDate(deckIds: string[]): Date | undefined {
    const times = data.decks
      .filter((deck) => deckIds.includes(deck.id))
      .flatMap((deck) => deck.cardIds)
      .map((id) => data.schedules[id]?.due.getTime())
      .filter((time) => time !== undefined);
    return times.length > 0 ? new Date(Math.min(...times)) : undefined;
  }

  return {
    data,
    saveFailed,
    addDeck,
    deleteDeck,
    addFlashcard,
    addPack,
    deleteCard,
    reviewCard,
    replaceData,
    resetData,
    dueCardIds,
    nextDueDate,
  };
}

export type AppActions = ReturnType<typeof useAppData>;

const STATE_NAMES: Record<State, ReviewLogEntry["stateBefore"]> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};
