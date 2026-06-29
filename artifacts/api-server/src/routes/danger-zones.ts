import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, dangerZonesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Radius of Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Check if point is inside polygon (Ray casting algorithm)
function isPointInPolygon(
  point: { latitude: number; longitude: number },
  polygon: { latitude: number; longitude: number }[]
): boolean {
  const x = point.latitude;
  const y = point.longitude;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].latitude;
    const yi = polygon[i].longitude;
    const xj = polygon[j].latitude;
    const yj = polygon[j].longitude;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

router.get("/danger-zones", async (req, res): Promise<void> => {
  try {
    const zones = await db.select().from(dangerZonesTable);
    res.json(zones);
  } catch (error) {
    logger.error(error, "Failed to fetch danger zones");
    res.status(500).json({ error: "Failed to fetch danger zones" });
  }
});

router.post("/danger-zones", async (req, res): Promise<void> => {
  try {
    const { name, description, severity, coordinates, radius, createdBy } =
      req.body;

    if (!name || !coordinates || !createdBy) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      res.status(400).json({
        error: "Coordinates must be an array with at least 2 points",
      });
      return;
    }

    const [zone] = await db
      .insert(dangerZonesTable)
      .values({
        name,
        description,
        severity: severity || "medium",
        coordinates,
        radius,
        createdBy,
      })
      .returning();

    res.status(201).json(zone);
  } catch (error) {
    logger.error(error, "Failed to create danger zone");
    res.status(500).json({ error: "Failed to create danger zone" });
  }
});

router.get("/danger-zones/:id", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const [zone] = await db
      .select()
      .from(dangerZonesTable)
      .where(eq(dangerZonesTable.id, parseInt(id)));

    if (!zone) {
      res.status(404).json({ error: "Danger zone not found" });
      return;
    }

    res.json(zone);
  } catch (error) {
    logger.error(error, "Failed to fetch danger zone");
    res.status(500).json({ error: "Failed to fetch danger zone" });
  }
});

router.patch("/danger-zones/:id", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, severity, coordinates, radius } = req.body;

    const updates: any = {};
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (severity) updates.severity = severity;
    if (coordinates) updates.coordinates = coordinates;
    if (radius) updates.radius = radius;
    updates.updatedAt = new Date();

    const [zone] = await db
      .update(dangerZonesTable)
      .set(updates)
      .where(eq(dangerZonesTable.id, parseInt(id)))
      .returning();

    if (!zone) {
      res.status(404).json({ error: "Danger zone not found" });
      return;
    }

    res.json(zone);
  } catch (error) {
    logger.error(error, "Failed to update danger zone");
    res.status(500).json({ error: "Failed to update danger zone" });
  }
});

router.delete("/danger-zones/:id", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const [deleted] = await db
      .delete(dangerZonesTable)
      .where(eq(dangerZonesTable.id, parseInt(id)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Danger zone not found" });
      return;
    }

    res.sendStatus(204);
  } catch (error) {
    logger.error(error, "Failed to delete danger zone");
    res.status(500).json({ error: "Failed to delete danger zone" });
  }
});

// Check if a location is in any danger zone
router.post("/danger-zones/check-location", async (req, res): Promise<void> => {
  try {
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: "Missing latitude or longitude" });
      return;
    }

    const zones = await db.select().from(dangerZonesTable);
    const point = { latitude, longitude };
    const dangerousZones = [];

    for (const zone of zones) {
      const coords = zone.coordinates as any;
      const inZone = isPointInPolygon(point, coords);

      if (inZone) {
        dangerousZones.push({
          id: zone.id,
          name: zone.name,
          severity: zone.severity,
          description: zone.description,
        });
      } else if (zone.radius) {
        // Check if within radius (for circular zones)
        const centerLat = coords[0].latitude;
        const centerLon = coords[0].longitude;
        const distance = calculateDistance(
          latitude,
          longitude,
          centerLat,
          centerLon
        );
        if (distance <= parseFloat(zone.radius as any)) {
          dangerousZones.push({
            id: zone.id,
            name: zone.name,
            severity: zone.severity,
            description: zone.description,
            distance: distance.toFixed(2),
          });
        }
      }
    }

    res.json({
      isDangerous: dangerousZones.length > 0,
      zones: dangerousZones,
      threat: dangerousZones.some((z) => z.severity === "critical")
        ? "critical"
        : dangerousZones.some((z) => z.severity === "high")
          ? "high"
          : dangerousZones.some((z) => z.severity === "medium")
            ? "medium"
            : "low",
    });
  } catch (error) {
    logger.error(error, "Failed to check location");
    res.status(500).json({ error: "Failed to check location" });
  }
});

// Get nearby danger zones within radius (km)
router.get(
  "/danger-zones/nearby/:latitude/:longitude/:radius",
  async (req, res): Promise<void> => {
    try {
      const { latitude, longitude, radius } = req.params;
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      const searchRadius = parseFloat(radius) || 10;

      const zones = await db.select().from(dangerZonesTable);
      const nearby = [];

      for (const zone of zones) {
        const coords = zone.coordinates as any;
        const centerLat = coords[0].latitude;
        const centerLon = coords[0].longitude;
        const distance = calculateDistance(lat, lon, centerLat, centerLon);

        if (distance <= searchRadius) {
          nearby.push({
            ...zone,
            distance: distance.toFixed(2),
          });
        }
      }

      res.json(nearby.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance)));
    } catch (error) {
      logger.error(error, "Failed to find nearby zones");
      res.status(500).json({ error: "Failed to find nearby zones" });
    }
  }
);

export default router;
