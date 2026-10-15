// Small hand-made charts for the Progress screen: plain SVG and CSS, no chart library.
// Every mark has a hover (or tap) tooltip, and every chart can show its numbers as a table.

import { useRef, useState, type ReactNode } from "react";
import type { CalendarDay, DeckMastery } from "../progress";

// ---------- Tooltip ----------

type Tip = { x: number; y: number; text: string };

function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  function show(event: React.PointerEvent, text: string) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: event.clientX - box.left, y: event.clientY - box.top, text });
  }
  // Props for anything that should show a tooltip: hover with a mouse, tap on a phone.
  const hoverProps = (text: string) => ({
    onPointerEnter: (event: React.PointerEvent) => show(event, text),
    onPointerMove: (event: React.PointerEvent) => show(event, text),
    onPointerDown: (event: React.PointerEvent) => show(event, text),
    onPointerLeave: () => setTip(null),
  });
  return { ref, tip, hoverProps };
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.text}
    </div>
  );
}

// ---------- "Show the numbers" ----------

export function NumbersTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <details className="numbers">
      <summary>Show the numbers</summary>
      <div className="table-scroll">
        <table className="history">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------- Column chart ----------

export type Column = {
  label: string;
  value: number;
  tooltip: string;
  marker?: string; // e.g. "Exam": a flag above the column
};

type ColumnChartProps = {
  columns: Column[];
  title: string; // for screen readers
  formatValue?: (value: number) => string;
  labelEvery?: number; // show every nth label along the bottom (always the last one)
};

const W = 360;
const H = 170;
const LEFT = 30;
const RIGHT = 6;
const TOP = 26;
const BOTTOM = 22;

// One series of columns growing from a baseline. Only the tallest column gets
// a value label; the rest are in the tooltip and the table.
export function ColumnChart({ columns, title, formatValue = String, labelEvery = 1 }: ColumnChartProps) {
  const { ref, tip, hoverProps } = useTooltip();
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const slot = plotW / columns.length;
  const barW = Math.min(24, slot * 0.62);
  const top = niceMax(Math.max(...columns.map((c) => c.value)));
  const tallest = columns.reduce((best, c, i) => (c.value > columns[best].value ? i : best), 0);
  const y = (value: number) => TOP + plotH - (value / top) * plotH;

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {/* Hairline grid: the baseline and the top value */}
        <line className="grid" x1={LEFT} x2={W - RIGHT} y1={y(0)} y2={y(0)} />
        <line className="grid" x1={LEFT} x2={W - RIGHT} y1={y(top)} y2={y(top)} />
        <text className="tick" x={LEFT - 6} y={y(top) + 4} textAnchor="end">
          {formatValue(top)}
        </text>
        <text className="tick" x={LEFT - 6} y={y(0) + 4} textAnchor="end">
          0
        </text>

        {columns.map((column, i) => {
          const center = LEFT + slot * i + slot / 2;
          const showLabel = (columns.length - 1 - i) % labelEvery === 0;
          return (
            <g key={i}>
              {column.marker && (
                <>
                  <line className="marker-line" x1={center} x2={center} y1={TOP - 6} y2={y(0)} />
                  <text className="marker" x={center} y={TOP - 10} textAnchor="middle">
                    ⚑ {column.marker}
                  </text>
                </>
              )}
              {column.value > 0 && (
                <path className="bar" d={roundedTop(center - barW / 2, y(column.value), barW, y(0))} />
              )}
              {i === tallest && column.value > 0 && (
                <text className="value" x={center} y={y(column.value) - 5} textAnchor="middle">
                  {formatValue(column.value)}
                </text>
              )}
              {showLabel && (
                <text className="tick" x={center} y={H - 6} textAnchor="middle">
                  {column.label}
                </text>
              )}
              {/* Invisible, taller-than-the-bar target for the tooltip */}
              <rect
                className="hit"
                x={center - slot / 2}
                y={TOP - 14}
                width={slot}
                height={plotH + 14}
                {...hoverProps(column.tooltip)}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// A column with a 4px rounded top and a square bottom on the baseline.
function roundedTop(x: number, top: number, width: number, base: number): string {
  const r = Math.min(4, width / 2, base - top);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${base} Z`;
}

// A clean number for the top of the scale: 1, 2, 5, 10, 20, 50...
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (value <= step * power) return step * power;
  return 10 * power;
}

// ---------- Study calendar heatmap ----------

const CELL = 12;
const GAP = 3;
const CAL_LEFT = 22;
const CAL_TOP = 16;
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

// The color step for a day: 0 = nothing, then 1-4, 5-9, 10-19, 20+ reviews.
function heatLevel(reviews: number): number {
  if (reviews === 0) return 0;
  if (reviews < 5) return 1;
  if (reviews < 10) return 2;
  if (reviews < 20) return 3;
  return 4;
}

const HEAT_LEGEND = ["none", "1–4", "5–9", "10–19", "20+"];

export function StudyCalendar({ weeks }: { weeks: CalendarDay[][] }) {
  const { ref, tip, hoverProps } = useTooltip();
  const width = CAL_LEFT + weeks.length * (CELL + GAP);
  const height = CAL_TOP + 7 * (CELL + GAP);

  return (
    <div className="chart calendar" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reviews per day, last 4 months">
        {WEEKDAYS.map((name, row) => (
          <text key={row} className="tick" x={0} y={CAL_TOP + row * (CELL + GAP) + CELL - 2}>
            {name}
          </text>
        ))}
        {weeks.map((week, column) => {
          const first = week[0].date;
          const previous = weeks[column - 1]?.[0].date;
          const newMonth = !previous || previous.getMonth() !== first.getMonth();
          return (
            <g key={column}>
              {newMonth && column < weeks.length - 1 && (
                <text className="tick" x={CAL_LEFT + column * (CELL + GAP)} y={10}>
                  {first.toLocaleDateString(undefined, { month: "short" })}
                </text>
              )}
              {week.map((day, row) =>
                day.future ? null : (
                  <rect
                    key={day.key}
                    className={`heat heat-${heatLevel(day.reviews)}`}
                    x={CAL_LEFT + column * (CELL + GAP)}
                    y={CAL_TOP + row * (CELL + GAP)}
                    width={CELL}
                    height={CELL}
                    rx={2.5}
                    {...hoverProps(
                      `${day.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${day.reviews} ${day.reviews === 1 ? "review" : "reviews"}`,
                    )}
                  />
                ),
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span className="muted">Less</span>
        {HEAT_LEGEND.map((label, level) => (
          <span key={label} className={`swatch heat-${level}`} title={`${label} reviews`} />
        ))}
        <span className="muted">More</span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Mastery per deck ----------

const STAGES = [
  { key: "fresh", label: "New" },
  { key: "learning", label: "Learning" },
  { key: "solid", label: "Solid" },
] as const;

export function MasteryBars({ decks }: { decks: DeckMastery[] }) {
  const { ref, tip, hoverProps } = useTooltip();
  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        {STAGES.map((stage) => (
          <span key={stage.key} className="legend-item">
            <span className={`swatch stage-${stage.key}`} /> {stage.label}
          </span>
        ))}
      </div>
      <div className="mastery-rows">
        {decks.map((deck) => {
          const total = deck.fresh + deck.learning + deck.solid;
          return (
            <div key={deck.deckId} className="mastery-row">
              <div className="mastery-name">
                <span>{deck.name}</span>
                <span className="muted">
                  {deck.solid} of {total} solid
                </span>
              </div>
              <div className="stack" role="img" aria-label={`${deck.name}: ${deck.fresh} new, ${deck.learning} learning, ${deck.solid} solid`}>
                {total === 0 && <span className="stack-empty" />}
                {STAGES.map((stage) =>
                  deck[stage.key] > 0 ? (
                    <span
                      key={stage.key}
                      className={`segment stage-${stage.key}`}
                      style={{ flexGrow: deck[stage.key] }}
                      {...hoverProps(`${deck.name}: ${deck[stage.key]} ${stage.label.toLowerCase()}`)}
                    />
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- A panel with a title, a caption and the chart ----------

export function ChartPanel({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <section className="panel chart-panel">
      <h2>{title}</h2>
      <p className="caption">{caption}</p>
      {children}
    </section>
  );
}
