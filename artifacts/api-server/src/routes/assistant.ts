import { Router } from "express";
import { z } from "zod";

const router = Router();

// ── PhoneLink knowledge base ──────────────────────────────────────────────────

interface Rule {
  patterns: RegExp[];
  response: string;
}

const RULES: Rule[] = [
  // ── Greetings ──────────────────────────────────────────────────────────────
  {
    patterns: [/^(hi|hello|hey|sup|yo|good\s*(morning|afternoon|evening)|what'?s\s*up)/i],
    response:
      "Hey! 👋 I'm the PhoneLink assistant. I know everything about the app — location sharing, GeoBoard, SOS, invites, geofences, and more. What do you need help with?",
  },

  // ── What is PhoneLink ──────────────────────────────────────────────────────
  {
    patterns: [/what\s*is\s*phone\s*link|about\s*phone\s*link|tell\s*me\s*about|explain\s*phone\s*link|overview|what\s*does.*do/i],
    response:
      "📱 **PhoneLink** is a real-time location-sharing and personal safety platform.\n\nCore features:\n• **Invite contacts** — send a consent link via WhatsApp; they grant location access in one tap\n• **Live Map** — watch all your contacts' positions update in real time\n• **GeoBoard** — auto-captures selfie photos & a short video the moment someone grants consent\n• **Geofences** — draw virtual zones; get push alerts when someone enters or leaves\n• **SOS Alerts** — instantly broadcast your location + emergency message to every trusted contact\n• **Location History** — replay any contact's movement trail on a satellite map\n• **Push Notifications** — browser-based alerts for every safety event, even with the app closed\n• **Activity Feed** — full log of all consents, location events, and alerts",
  },

  // ── Invites ────────────────────────────────────────────────────────────────
  {
    patterns: [/invite|send.*link|whatsapp.*invite|how.*add.*contact|tracking\s*link/i],
    response:
      "📨 **Sending an Invite:**\n1. Go to **Invites** in the menu\n2. Enter the recipient's name (optional) and WhatsApp number\n3. Choose what permission to request — Location, Camera, etc.\n4. Edit the message if you want (it's pre-filled with a friendly text)\n5. Tap **Send via WhatsApp** — the app opens WhatsApp with the message + consent link already written\n\nThe recipient just taps the link, grants access, and you can immediately see their location on the Live Map. The consent link is short and looks like: `yourapp.replit.app/consent/aB3xK9mQ`",
  },

  // ── Consent / Granting ────────────────────────────────────────────────────
  {
    patterns: [/consent|grant.*location|accept.*invite|share.*location.*with|how.*recipient|what.*happen.*link/i],
    response:
      "✅ **How Consent Works (recipient side):**\n1. Recipient taps the WhatsApp link\n2. They see a **Secure Location Request** page — no account needed\n3. They tap **Grant Access** and allow browser GPS\n4. Their location is shared live; the sender gets a push notification immediately\n5. **GeoBoard** auto-captures 5 selfie photos + a 5-second video at the moment of consent (camera permission is requested)\n6. The recipient can tap **Go Back** to return to WhatsApp any time — sharing continues in the background as long as the page is open",
  },

  // ── Live Map ───────────────────────────────────────────────────────────────
  {
    patterns: [/live\s*map|real.?time.*location|watch.*contact|see.*location|track.*contact|map/i],
    response:
      "🗺️ **Live Map:**\n• Shows all contacts who have granted you location access, updating in real time\n• Satellite imagery (Google tiles — pure satellite + road labels overlay) for maximum clarity\n• Tap a contact marker to see their name, coordinates, accuracy, and last-seen time\n• Toggle between **Map**, **Satellite**, and **Heatmap** views\n• Use the layer icon (bottom-left) to switch views\n• Contacts who haven't updated recently show a staleness alert\n• Zoom goes up to level 21 for very precise street-level detail",
  },

  // ── GeoBoard ──────────────────────────────────────────────────────────────
  {
    patterns: [/geoboard|geo.?board|geo.*photo|photo.*capture|selfie|camera.*consent|video.*capture/i],
    response:
      "📸 **GeoBoard:**\nWhen a contact grants location consent, PhoneLink silently:\n1. Captures **5 selfie photos** using the front camera (1 second apart)\n2. Records a **5-second video clip**\n3. Stores everything linked to that consent event\n\nYou can view all captured media at **GeoBoard** in the menu — photos are shown as a grid, and you can play back the video. This gives you a visual record of who granted access and what they looked like at the time.",
  },

  // ── Geofences ─────────────────────────────────────────────────────────────
  {
    patterns: [/geofence|geo.?fence|virtual.*zone|zone.*alert|enter.*exit.*alert|boundary/i],
    response:
      "📍 **Geofences:**\n• Draw virtual perimeter zones on the map (circle or polygon)\n• Assign one or more contacts to a geofence\n• Get a **push notification** whenever a contact enters or exits the zone\n• Useful for: school zones, home perimeters, work areas, restricted regions\n• Manage all geofences from the Geofences page — create, edit, or delete zones",
  },

  // ── SOS ───────────────────────────────────────────────────────────────────
  {
    patterns: [/sos|emergency|panic|distress|help.*emergency|emergency.*alert/i],
    response:
      "🚨 **SOS Alert:**\nTap the red **SOS** button (bottom-right on the Live Map) to instantly:\n1. Broadcast a push notification to **all your trusted contacts**\n2. Include your **current GPS coordinates** and address\n3. Optionally send a WhatsApp message to all contacts at the same time\n\n⚠️ Only use SOS in real emergencies — all contacts are alerted simultaneously. There is a short confirmation step to prevent accidental triggers.",
  },

  // ── Push notifications ────────────────────────────────────────────────────
  {
    patterns: [/push\s*notif|notification|alert.*push|enable.*notif|browser.*notif|vapid/i],
    response:
      "🔔 **Push Notifications:**\nPhoneLink uses browser-based Web Push so you get alerts even when the app is closed.\n\nYou'll receive alerts for:\n• ✅ A contact granted location access\n• ⏰ A contact's location hasn't updated (staleness alert)\n• 📍 Geofence entry / exit events\n• 🚨 SOS broadcasts from other users\n\n**To enable:** Go to **Settings → Notifications** and tap Enable. You'll be asked to allow browser notifications — tap Allow. If you accidentally denied, reset notification permissions in your browser settings.",
  },

  // ── Location History ──────────────────────────────────────────────────────
  {
    patterns: [/location\s*history|history|movement|trail|replay|past\s*location|where.*been/i],
    response:
      "📅 **Location History:**\n• Select any contact and tap **History** to see their movement trail\n• The trail is drawn as a polyline on a satellite map\n• Dots show each recorded position; tap a dot for timestamp and accuracy\n• Filter by date range\n• Map uses split satellite + labels layers (Google tiles) with zoom up to level 22 for maximum detail",
  },

  // ── Activity Feed ─────────────────────────────────────────────────────────
  {
    patterns: [/activity|feed|log|event.*log|history.*log|audit/i],
    response:
      "📋 **Activity Feed:**\nA chronological log of every event in your PhoneLink account:\n• Consent granted / revoked\n• Location updates received\n• Geofence triggers\n• SOS alerts sent or received\n• Invite sent\n\nAccess it from the **Activity** icon in the bottom nav. You can filter by event type.",
  },

  // ── Permissions / Settings ────────────────────────────────────────────────
  {
    patterns: [/permission|setting|privacy|revoke|manage.*contact|contact.*manage|remove.*contact/i],
    response:
      "⚙️ **Permissions & Settings:**\n• **Permissions page** — see every contact who has granted you access; revoke any at any time\n• **Settings** — manage your profile name, push notification preferences, and account\n• Revoking a contact immediately stops their location from appearing on your Live Map\n• Contacts are notified when their access is revoked",
  },

  // ── How to get started ────────────────────────────────────────────────────
  {
    patterns: [/get\s*start|how\s*do\s*i\s*start|setup|set\s*up|first\s*time|new\s*user|onboard/i],
    response:
      "🚀 **Getting Started with PhoneLink:**\n1. **Create your account** — enter your name on the profile/login screen (stored locally)\n2. **Enable push notifications** — Settings → Notifications → Enable (so you get alerts)\n3. **Send your first invite** — Invites → fill in a number → Send via WhatsApp\n4. **Wait for consent** — you'll get a push notification the moment they grant access\n5. **Open the Live Map** — see their real-time position immediately\n6. Optionally set up a **Geofence** around an important location\n\nThat's it — PhoneLink is running!",
  },

  // ── Safety / Privacy ──────────────────────────────────────────────────────
  {
    patterns: [/safe|privacy|secure|data|who\s*can\s*see|anonymous|track.*without|spy/i],
    response:
      "🔒 **Privacy & Safety:**\n• **Explicit consent required** — no one can be tracked without tapping the consent link and actively granting access\n• Location data is only shared with the person who sent the invite\n• Consent can be revoked at any time by the recipient (or the sender)\n• GeoBoard photos/video are only visible to the invite sender\n• No background tracking without the consent page open\n• PhoneLink does not sell or share your data",
  },

  // ── Contacts ──────────────────────────────────────────────────────────────
  {
    patterns: [/contact|contacts\s*page|how\s*many\s*contact|add.*person|add.*someone/i],
    response:
      "👥 **Contacts:**\nContacts in PhoneLink are people who have granted you location access via a consent link. The **Contacts** count on the Live Map shows how many active grants you have.\n\nTo add a new contact: send them an invite (Invites page). Once they accept, they automatically appear on your map.",
  },

  // ── Staleness alerts ──────────────────────────────────────────────────────
  {
    patterns: [/stale|offline|not\s*updating|last\s*seen|inactive/i],
    response:
      "⏰ **Staleness Alerts:**\nIf a contact's location hasn't updated for more than 5 minutes, PhoneLink sends you a push notification: \"[Name] hasn't sent a location update recently.\"\n\nThis usually means:\n• They closed the consent page / browser\n• They lost GPS signal\n• Their device went offline\n\nThe alert fires once per contact per offline period — it won't spam you repeatedly.",
  },

  // ── WhatsApp integration ──────────────────────────────────────────────────
  {
    patterns: [/whatsapp|wa\.me|send.*whatsapp|open.*whatsapp/i],
    response:
      "💬 **WhatsApp Integration:**\nPhoneLink uses WhatsApp as the delivery channel for consent links:\n• The invite compose screen opens WhatsApp with the message + link pre-filled\n• The default message is conversational: \"Yo, you gotta check this out…\" — feel free to edit it\n• The consent link is short (e.g. `/consent/aB3xK9mQ`) so it looks clean in a chat\n• After granting location access, the recipient's **Go Back** button returns them straight to WhatsApp",
  },

  // ── Satellite map / tiles ─────────────────────────────────────────────────
  {
    patterns: [/satellite|tile|map.*quality|blur.*map|map.*blur|zoom|imagery/i],
    response:
      "🛰️ **Map Imagery:**\nPhoneLink uses Google satellite tiles rendered in two separate layers for maximum sharpness:\n• **Satellite layer** (`lyrs=s`) — pure photographic imagery, no blending\n• **Labels layer** (`lyrs=h`) — roads, place names, and POI labels rendered on top\n\nMax native zoom is **21**, and you can zoom in manually to 22. The split-layer approach avoids the blurry compression of the blended `lyrs=y` tile.",
  },

  // ── Troubleshooting ───────────────────────────────────────────────────────
  {
    patterns: [/not\s*work|broken|bug|error|problem|issue|fix|help.*with|trouble/i],
    response:
      "🛠️ **Troubleshooting Tips:**\n\n**Can't see contact on map?**\n→ Check they accepted the invite (status should be \"accepted\" in Invites)\n→ Make sure their consent page is still open\n\n**Push notifications not arriving?**\n→ Settings → Notifications → Enable, then allow browser permissions\n\n**Map looks blurry?**\n→ Pinch/zoom in — tiles sharpen at z19+\n\n**Consent link not working?**\n→ Share the full URL; short token links expire if the invite was deleted\n\n**Location not updating?**\n→ Keep the consent page open in the foreground or a background tab",
  },

  // ── Thanks / Goodbye ──────────────────────────────────────────────────────
  {
    patterns: [/thank|thanks|thx|appreciate|bye|goodbye|see\s*ya|later/i],
    response:
      "You're welcome! 😊 If you need anything else about PhoneLink — features, troubleshooting, or how something works — just ask. Stay safe! 🛡️",
  },
];

const FALLBACK =
  "🤔 I'm not sure about that specific question. Here's what I can help with:\n\n• **Invites** — how to send a consent link via WhatsApp\n• **Live Map** — real-time contact tracking\n• **GeoBoard** — auto-captured photos & video on consent\n• **Geofences** — entry/exit zone alerts\n• **SOS** — emergency broadcast\n• **Push Notifications** — setup & events\n• **Location History** — movement trail replay\n• **Privacy & Safety** — how consent and data work\n\nTry asking something like \"How do I invite someone?\" or \"What is GeoBoard?\"";

function findResponse(message: string): string {
  const msg = message.trim();
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(msg))) {
      return rule.response;
    }
  }
  return FALLBACK;
}

// ── Routes ────────────────────────────────────────────────────────────────────

const SendMessageBody = z.object({
  message: z.string().min(1).max(4000),
  userId: z.number().int().positive().optional(),
});

// POST /assistant — rule-based, instant JSON response
router.post("/assistant", (req, res) => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const reply = findResponse(parsed.data.message);
  res.json({ reply });
});

// GET /assistant/history — stub (rule-based bots have no server-side history)
router.get("/assistant/history", (_req, res) => {
  res.json({ messages: [] });
});

export default router;
