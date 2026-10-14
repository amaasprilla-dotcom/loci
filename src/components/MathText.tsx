import katex from "katex";

// Shows text where anything between $...$ is rendered as math with KaTeX.
// Example: "Speed is $v = \frac{d}{t}$" -> "Speed is" followed by a fraction.
export function MathText({ text }: { text: string }) {
  const parts = text.split("$");

  // Splitting on "$" puts math at the odd positions. With an odd number of
  // "$" signs the last one has no partner, so treat the tail as plain text.
  if (parts.length % 2 === 0) {
    const tail = parts.pop();
    parts[parts.length - 1] += "$" + tail;
  }

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{ __html: katex.renderToString(part, { throwOnError: false }) }}
          />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
