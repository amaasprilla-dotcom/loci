// Built-in packs: ready-made decks stored as JSON files in this folder.

import type { Card } from "../types";
import kinematics from "./kinematics.json";
import spanish from "./spanish.json";
import trigonometry from "./trigonometry.json";

// A card as written in a pack file: no id yet (one is made when it's added).
export type PackCard = Card extends infer C ? (C extends Card ? Omit<C, "id"> : never) : never;

export type Pack = {
  name: string;
  cards: PackCard[];
};

// Milestone 4 adds a proper Packs screen.
export const PACKS: Pack[] = [trigonometry as Pack, kinematics as Pack, spanish as Pack];
