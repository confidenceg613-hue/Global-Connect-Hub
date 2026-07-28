import { useEffect, useState } from "react";

/** A three-second, non-blocking reveal shown while map tiles and markers settle. */
export function MapCloudReveal() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div className="map-cloud-reveal" aria-hidden="true">
      <div className="map-cloud-reveal__veil map-cloud-reveal__veil--one" />
      <div className="map-cloud-reveal__veil map-cloud-reveal__veil--two" />
      <div className="map-cloud-reveal__veil map-cloud-reveal__veil--three" />
      <div className="map-cloud-reveal__sun" />
      <div className="map-cloud-reveal__eagle">🦅</div>
      <p className="map-cloud-reveal__label">ENTERING THE ANCIENT SKY</p>
    </div>
  );
}