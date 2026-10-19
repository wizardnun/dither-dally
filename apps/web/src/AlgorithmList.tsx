import { ALGORITHMS, FAMILY_LABELS, type Family } from "@dither-dally/core";
import { Canvas } from "./Canvas.tsx";

const families = Object.keys(FAMILY_LABELS) as Family[];

interface Props {
  selected: string;
  thumbnails: Record<string, ImageData>;
  onSelect: (id: string) => void;
}

/** Source-list style browser of every algorithm, each with a live thumbnail of your image. */
export function AlgorithmList({ selected, thumbnails, onSelect }: Props) {
  return (
    <nav className="algo-list" aria-label="Algorithms">
      {families.map((family) => (
        <div key={family} className="algo-group" role="group" aria-labelledby={`fam-${family}`}>
          <h2 id={`fam-${family}`} className="group-title">
            {FAMILY_LABELS[family]}
          </h2>
          {ALGORITHMS.filter((a) => a.family === family).map((a) => (
            <button
              key={a.id}
              type="button"
              className="algo-row"
              aria-current={a.id === selected ? "true" : undefined}
              onClick={() => onSelect(a.id)}
            >
              <span className="thumb">
                <Canvas image={thumbnails[a.id] ?? null} label="" />
              </span>
              <span className="algo-name">{a.name}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
