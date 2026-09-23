/** `inline` sizes it to sit inside a button next to its label. */
export function Spinner({ inline }: { inline?: boolean }) {
  return <span className={`spinner${inline ? " spinner--inline" : ""}`} role="status" aria-label="Loading" />;
}
