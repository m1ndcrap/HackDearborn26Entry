import type { TextSize } from "./store";

const SIZES: { value: TextSize; label: string; scale: string }[] = [
  { value: "normal", label: "Normal", scale: "1rem" },
  { value: "large", label: "Large", scale: "1.2rem" },
  { value: "xl", label: "Extra large", scale: "1.4rem" },
];

/** Bigger text for the whole app. Everything is sized in rem, so this scales every screen. */
export default function TextSizePicker({ value, onChange }: { value: TextSize; onChange: (s: TextSize) => void }) {
  return (
    <fieldset className="seg-group text-size">
      <legend>Text size</legend>
      <div className="seg">
        {SIZES.map((s) => (
          <button key={s.value} type="button" aria-pressed={value === s.value} onClick={() => onChange(s.value)}>
            <span className="aa" style={{ fontSize: s.scale }} aria-hidden="true">
              Aa
            </span>
            {s.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}