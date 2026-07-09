import { Router } from "express";

const router = Router();

/**
 * GET /api/config
 * Returns public client-side configuration values.
 * The Google Maps key must be present client-side for Maps Embed API iframes.
 * It is restricted by HTTP referrer in the Google Cloud console.
 */
router.get("/config", (_req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? null,
  });
});

export default router;
