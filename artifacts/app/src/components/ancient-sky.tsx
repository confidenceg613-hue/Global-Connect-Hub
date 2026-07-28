import { Feather } from "lucide-react";

/**
 * A purely decorative, pointer-free atmospheric layer shared by the product.
 * It gives the DeepFalcon identity a quiet sense of motion without competing
 * with data-heavy screens such as live maps.
 */
export function AncientSky() {
  return (
    <div className="ancient-sky" aria-hidden="true">
      <div className="ancient-sky__aurora" />
      <div className="ancient-sky__bird ancient-sky__bird--one">🦅</div>
      <div className="ancient-sky__bird ancient-sky__bird--two">🦅</div>
      <Feather className="ancient-sky__feather ancient-sky__feather--one" />
      <Feather className="ancient-sky__feather ancient-sky__feather--two" />
      <Feather className="ancient-sky__feather ancient-sky__feather--three" />
      <span className="ancient-sky__star ancient-sky__star--one" />
      <span className="ancient-sky__star ancient-sky__star--two" />
      <span className="ancient-sky__star ancient-sky__star--three" />
    </div>
  );
}