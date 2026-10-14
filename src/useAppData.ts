// One React hook that owns all app data and every way to change it.
// Screens call these actions; the hook saves to localStorage after each change.

import { useEffect, useState } from "react";
import { loadData, makeId, saveData, type AppData } from "./storage";
import { isDue, newSchedule, rate, type Grade, type Schedule } from "./scheduler";
import type { Card } from "./types";

export function useAppData() {
  const [data, setData] = useState<AppData>(loadData);

  useEffect(() => {
    saveData(data);
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

  // Saves the rating and returns the card's new schedule.
  function reviewCard(cardId: string, grade: Grade): Schedule {
    const next = rate(data.schedules[cardId], grade);
    setData((d) => ({ ...d, schedules: { ...d.schedules, [cardId]: next } }));
    return next;
  }

  // Ids of cards in the given decks that are due right now.
  function dueCardIds(deckIds: string[], now = new Date()): string[] {
    return data.decks
      .filter((deck) => deckIds.includes(deck.id))
      .flatMap((deck) => deck.cardIds)
      .filter((id) => data.schedules[id] && isDue(data.schedules[id], now));
  }

  return { data, addDeck, deleteDeck, addFlashcard, deleteCard, reviewCard, dueCardIds };
}

export type AppActions = ReturnType<typeof useAppData>;
