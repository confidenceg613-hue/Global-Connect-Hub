import { Router } from "express";
import { z } from "zod";

const router = Router();

// ── Knowledge base ────────────────────────────────────────────────────────────

interface Rule {
  patterns: RegExp[];
  response: string;
}

const RULES: Rule[] = [

  // ── GREETINGS ───────────────────────────────────────────────────────────────
  {
    patterns: [/^(hi+|hello+|hey+|sup|yo+|hiya|howdy|greetings|good\s*(morning|afternoon|evening|day)|what'?s\s*up|wassup|wazzup|hows?\s*it|how\s*are\s*you|how\s*r\s*u)\b/i],
    response: "Hey! 👋 I'm the PhoneLink assistant — I know everything about the app. Ask me anything:\n\n• How to invite someone\n• What GeoBoard does\n• Setting up SOS alerts\n• Geofences & push notifications\n• Location history & privacy\n\nWhat do you need help with?",
  },

  // ── WHAT IS PHONELINK ───────────────────────────────────────────────────────
  {
    patterns: [/what\s*(is|are)\s*(phone\s*link|this\s*app|the\s*app)|about\s*phone\s*link|tell\s*me\s*about|explain\s*phone\s*link|overview|what\s*does\s*(phone\s*link|it|the\s*app)\s*do|purpose\s*of|describe\s*(the\s*app|phone\s*link)/i],
    response: "📱 **PhoneLink** is a real-time location-sharing and personal safety platform.\n\n**How it works:**\n1. You send a consent link via WhatsApp to someone you trust\n2. They tap it, grant GPS access, and you instantly see their location\n3. Location updates live on your map as long as they keep the page open\n\n**Key features:**\n🗺️ **Live Map** — real-time positions of all contacts\n📸 **GeoBoard** — auto-captures selfies + video on consent\n📍 **Geofences** — alerts when contacts enter/leave zones\n🚨 **SOS** — emergency broadcast to all contacts\n📅 **Location History** — movement trail replay\n🔔 **Push Notifications** — alerts even when app is closed\n📋 **Activity Feed** — full event log\n\nNo account required for the recipient — they just tap a link.",
  },

  // ── GETTING STARTED ─────────────────────────────────────────────────────────
  {
    patterns: [/get\s*start|how\s*(do\s*i\s*)?start|setup|set\s*up|first\s*time|new\s*(user|here)|onboard|begin|how\s*to\s*use|where\s*do\s*i\s*start|what\s*do\s*i\s*do\s*first/i],
    response: "🚀 **Getting Started with PhoneLink — 5 steps:**\n\n**Step 1** — Open PhoneLink and set your name in Profile\n\n**Step 2** — Enable push notifications: Settings → Notifications → Enable → Allow in browser\n\n**Step 3** — Go to **Invites**, enter a contact's WhatsApp number, and tap **Send via WhatsApp**\n\n**Step 4** — Your contact receives the message and taps the link. They grant GPS access in one tap — no account needed!\n\n**Step 5** — You get a push notification ✅ and their location appears on the **Live Map** immediately\n\nOptional: Set up a **Geofence** around home, school, or work for automatic entry/exit alerts.",
  },

  // ── INVITES ─────────────────────────────────────────────────────────────────
  {
    patterns: [/how\s*(do\s*i\s*)?(send|create|make|generate|write)\s*(an?\s*)?(invite|invitation|link|tracking\s*link|consent\s*link)|invite\s*someone|add\s*(a\s*)?(contact|someone|person)|send\s*(via\s*)?whatsapp|whatsapp\s*invite|how\s*to\s*invite/i],
    response: "📨 **How to Send an Invite:**\n\n1. Tap **Invites** in the navigation menu\n2. Enter the recipient's **name** (optional) and **WhatsApp number** with country code (e.g. +234...)\n3. Choose **Permission to Request** — Location is the default\n4. The message is pre-filled (you can edit it)\n5. Tap ✅ **I confirm the recipient has opted in**\n6. Tap **Send via WhatsApp** — WhatsApp opens with the message + link already written\n7. Just hit send in WhatsApp!\n\n💡 The consent link is short (e.g. `yourapp.replit.app/consent/aB3xK9mQ`) — it won't look spammy.",
  },

  // ── INVITE STATUS / TRACKING ────────────────────────────────────────────────
  {
    patterns: [/invite\s*status|did\s*they\s*accept|pending\s*invite|check\s*(if|whether)\s*(they|contact)|accepted|declined|waiting\s*for|how\s*do\s*i\s*know|track.*invite/i],
    response: "📊 **Checking Invite Status:**\n\nGo to **Invites** in the menu — each invite shows its status:\n\n🟡 **Pending** — link sent, they haven't tapped it yet\n✅ **Accepted** — they granted access; location is now live on your map\n❌ **Declined** — they opened the link but declined\n\nYou also get a **push notification** the moment they accept, so you don't have to keep checking.",
  },

  // ── CONSENT PAGE (RECIPIENT EXPERIENCE) ────────────────────────────────────
  {
    patterns: [/consent\s*page|what\s*(does|do)\s*(the\s*)?recipient|how\s*(does|do)\s*(the\s*)?(other\s*person|recipient|they|contact)\s*(see|use|experience|share|grant)|grant\s*(location|access)|accept\s*(invite|link)|what\s*happen(s)?\s*(when|after)\s*(they\s*tap|clicking|opening)\s*(the\s*)?link/i],
    response: "✅ **What the Recipient Sees (Consent Page):**\n\n1. They tap the WhatsApp link → a PhoneLink page opens in their browser\n2. They see **who** is requesting access and **what** type (e.g. Location)\n3. They tap **Grant Access** and allow GPS in the browser prompt\n4. The page switches to **LIVE SHARING** — their location is now streaming to you\n5. **GeoBoard** kicks in automatically: 5 selfie photos + a 5-second video are captured silently\n6. They can browse other apps freely — sharing continues in the background\n7. Tapping **Go Back** returns them to WhatsApp (sharing keeps going while the tab is open)\n\n⚡ You receive a push notification instantly when they grant.",
  },

  // ── LIVE MAP ────────────────────────────────────────────────────────────────
  {
    patterns: [/live\s*map|real.?time\s*(location|tracking|map)|watch\s*(contact|them|location)|see\s*(contact|their|someone'?s?)\s*location|track\s*(contact|someone)|where\s*(is|are)\s*(contact|they|someone)|map\s*(view|page|screen)/i],
    response: "🗺️ **Live Map — Real-Time Tracking:**\n\n**Accessing it:** Tap the map icon in the bottom navigation\n\n**What you see:**\n• 📍 Color-coded markers for each contact who has granted access\n• Marker shows name, coordinates, accuracy (e.g. ±8m), and time of last update\n• Map auto-centers and zooms to fit all contacts\n\n**Views available:**\n• 🛰️ **Satellite** (SAT button) — Google satellite imagery, very detailed\n• 🔥 **Heatmap** — density overlay showing where contacts spend time\n• 🗺️ Standard map\n\n**Controls:**\n• Zoom goes to level 21 for street-level detail\n• Layer icon (bottom-left) to switch views\n• Refresh button to force-pull latest positions\n\n**If a contact isn't updating:** They may have closed the consent tab. You'll get a staleness alert after 5 minutes.",
  },

  // ── GEOBOARD PHOTOS ─────────────────────────────────────────────────────────
  {
    patterns: [/geoboard|geo.?board|geo.*photo|photo.*capture|selfie|front\s*camera|auto.*photo|photo.*auto|capture.*photo|photo.*grant|5\s*photo/i],
    response: "📸 **GeoBoard — Auto Photo Capture:**\n\nWhen a contact grants location consent, PhoneLink **silently captures 5 photos** from their front camera, 1 second apart.\n\n**Why:** Gives you a visual record of who granted access and their surroundings at that moment.\n\n**Viewing photos:**\nGo to **GeoBoard** in the menu → you see a grid of all captured photos, grouped by contact and consent event.\n\n**On the recipient's side:**\n• They see a progress bar: \"GeoBoard: capturing photos 1/5…\"\n• After capture: \"GeoBoard: 5 photos saved ✓\"\n• Camera permission is requested automatically during consent\n\n**Storage:** Photos are stored server-side as base64 JPEG, linked to the invite/consent record.",
  },

  // ── GEOBOARD VIDEO ──────────────────────────────────────────────────────────
  {
    patterns: [/geo.*video|video.*geo|video.*capture|capture.*video|5\s*second\s*video|recording|record\s*(a\s*)?video|geoboard.*video|video.*geoboard/i],
    response: "🎥 **GeoBoard — Video Capture:**\n\nAlongside the 5 photos, PhoneLink also records a **5-second video clip** from the front camera at consent time.\n\n**Progress shown to recipient:**\n• \"GeoBoard: recording 5s video…\" with a progress bar\n• \"GeoBoard: uploading video…\" while it saves\n• \"GeoBoard: video saved ✓\" when done\n\n**Viewing the video:**\nGo to **GeoBoard** → select a contact → tap the video thumbnail to play it back.\n\n**Format:** Recorded as WebM (VP8 codec) for maximum mobile compatibility, then saved server-side.",
  },

  // ── GEOFENCES ───────────────────────────────────────────────────────────────
  {
    patterns: [/geofence|geo.?fence|virtual\s*(zone|boundary|perimeter)|zone\s*alert|boundary\s*alert|enter.*exit.*alert|alert.*enter.*exit|how\s*(to|do\s*i)\s*(set\s*up|create|make|add)\s*(a\s*)?geo|draw\s*(a\s*)?zone|perimeter\s*alert/i],
    response: "📍 **Geofences — Virtual Zone Alerts:**\n\n**What it does:** Draws an invisible boundary on the map. You get notified when a contact crosses it.\n\n**Setting one up:**\n1. Go to **Geofences** in the menu\n2. Tap **Create Geofence**\n3. Draw a circle or polygon on the map around the zone (e.g. home, school, work)\n4. Name it and assign one or more contacts\n5. Save — alerts are now active\n\n**Alert types:**\n🟢 **Entry alert** — contact entered the zone\n🔴 **Exit alert** — contact left the zone\n\n**Use cases:** School pickup zones, home perimeters, restricted areas, safe zones for elderly relatives\n\n**Managing:** Geofences page → tap any fence to edit radius, assigned contacts, or delete it.",
  },

  // ── SOS ALERTS ──────────────────────────────────────────────────────────────
  {
    patterns: [/sos|emergency\s*(alert|button|broadcast|signal|mode)|panic\s*(button|alert)|distress|send.*emergency|emergency.*send|how\s*(do\s*i)?\s*(trigger|send|use)\s*(sos|emergency)|red\s*button|help.*emergency/i],
    response: "🚨 **SOS — Emergency Alert:**\n\n**Triggering SOS:**\nTap the red **SOS** button in the bottom-right corner of the Live Map.\n\n**What happens instantly:**\n1. 📍 Your current GPS coordinates and address are captured\n2. 🔔 Push notifications are sent to **all your trusted contacts** simultaneously\n3. 💬 Optional WhatsApp message is prepared with your location link\n\n**Confirmation step:** There's a short confirm dialog to prevent accidental triggers — confirm within 3 seconds.\n\n**Your contacts receive:**\n\"🚨 SOS Alert from [Your Name] — [Address] — [Coordinates]\"\n\n⚠️ Only use in real emergencies. All contacts are alerted at once, every time.\n\n**After SOS:** Your location continues sharing normally. Contacts can tap the notification to see you on the map.",
  },

  // ── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
  {
    patterns: [/push\s*notif|notification|browser\s*notif|enable\s*notif|not\s*getting\s*(notif|alert)|alert.*not\s*(work|arriv|show)|notif.*not\s*(work|arriv|show)|how\s*(to|do\s*i)\s*(enable|set\s*up|turn\s*on)\s*notif|vapid|web\s*push/i],
    response: "🔔 **Push Notifications:**\n\n**How to enable:**\n1. Go to **Settings → Notifications**\n2. Tap **Enable Push Notifications**\n3. When the browser asks — tap **Allow**\n4. You'll see \"Notifications enabled ✓\"\n\n**Events that trigger notifications:**\n✅ Contact granted location access\n⏰ Contact hasn't updated for 5+ minutes (staleness alert)\n📍 Contact entered or exited a geofence\n🚨 SOS broadcast from another user\n❌ Contact revoked access\n\n**Notifications work even when the app is closed** — as long as your browser is running.\n\n**Not receiving notifications?**\n• Check browser permission: Settings → Site Settings → Notifications → Allow\n• On Android: ensure the browser app has notification permission in system settings\n• Try disabling and re-enabling in PhoneLink Settings\n• Make sure you're not in Do Not Disturb mode",
  },

  // ── LOCATION HISTORY ────────────────────────────────────────────────────────
  {
    patterns: [/location\s*history|movement\s*(trail|history|data)|trail|replay\s*(location|movement|history)|where\s*(have|has)\s*(they|contact|someone)\s*been|past\s*location|historical\s*(location|data|movement)|track.*history|history.*location/i],
    response: "📅 **Location History — Movement Trail Replay:**\n\n**Accessing it:**\nTap a contact on the Live Map → **View History**, or go to History in the navigation.\n\n**What you see:**\n• A polyline trail of all recorded GPS positions on a satellite map\n• Each dot = one location update (tap a dot for timestamp + accuracy)\n• Start point (green) and end point (red) markers\n\n**Filtering:**\n• Pick a date range to see movement for specific days\n\n**Map detail:**\n• Split satellite + labels tile layers for maximum sharpness\n• Zoom up to level 22 for very precise street-level detail\n• Trail fits automatically with tight 5% padding\n\n**Data retention:** All location pushes are stored server-side. History goes back as far as the contact has been sharing.",
  },

  // ── LOCATION REPORTS ────────────────────────────────────────────────────────
  {
    patterns: [/location\s*report|report|analytics|statistics|stats|summary\s*of\s*(location|movement)|movement\s*summary|data\s*report/i],
    response: "📊 **Location Reports & Analytics:**\n\nGo to **Reports** in the navigation menu.\n\n**What's included:**\n• Total distance traveled (per contact, per day/week)\n• Most visited locations\n• Time spent in each area\n• Number of location updates received\n• Geofence entry/exit counts\n\n**Filters:** By contact, by date range, or across all contacts.\n\nReports help you understand movement patterns over time — useful for family safety monitoring.",
  },

  // ── ACTIVITY FEED ───────────────────────────────────────────────────────────
  {
    patterns: [/activity\s*(feed|log|history)|event\s*log|audit\s*log|what\s*(happened|events)|log\s*of|feed|timeline|consent\s*log|all\s*events/i],
    response: "📋 **Activity Feed — Full Event Log:**\n\nTap the **Activity** icon in the bottom navigation.\n\n**Events logged:**\n• 📨 Invite sent (contact name, timestamp)\n• ✅ Location access granted\n• ❌ Access revoked\n• 📍 Geofence triggered (entry/exit, contact, zone)\n• 🚨 SOS alert sent or received\n• 🔔 Push notification events\n• 📸 GeoBoard captures\n\n**Filters:** Tap the filter icon to show only specific event types.\n\n**Use it to:** Verify a contact accepted an invite, check when someone last granted access, or audit all safety events.",
  },

  // ── PERMISSIONS / CONTACTS ──────────────────────────────────────────────────
  {
    patterns: [/permission|revoke|manage\s*(contact|access|permission)|remove\s*(contact|access|permission)|contact\s*list|who\s*(has|have)\s*(access|permission|granted)|contacts\s*page|grants|how\s*(do\s*i)?\s*(remove|revoke|delete|stop)\s*(a\s*)?(contact|access|permission)/i],
    response: "⚙️ **Permissions & Contact Management:**\n\n**Viewing your contacts:**\nGo to **Permissions** in the menu — see every contact who has granted you access, with their status and last update time.\n\n**Revoking access:**\n1. Permissions → find the contact\n2. Tap **Revoke Access**\n3. Their location immediately disappears from your Live Map\n4. The consent link is invalidated — even if they have the page open, updates stop\n\n**The counter on the Live Map** (e.g. \"CONTACTS 1 | GRANTS 1\") shows active contacts and active grants.\n\n**Re-inviting:** If you revoke and want to re-add them, send a new invite from the Invites page — they'll need to grant again.",
  },

  // ── SETTINGS / PROFILE ──────────────────────────────────────────────────────
  {
    patterns: [/setting|profile|change\s*(my\s*)?(name|profile)|account\s*setting|how\s*(do\s*i)?\s*(change|update|edit)\s*(my\s*)?(name|profile|account)|preferences|configuration/i],
    response: "⚙️ **Settings & Profile:**\n\n**Profile:**\n• Go to **Profile** (person icon, bottom nav)\n• Set or change your display name — this is what contacts see when you request access\n• Your name appears in the consent page they receive\n\n**Settings:**\n• **Notifications** — enable/disable push alerts\n• **Theme** — light or dark mode\n• **Account** — view your user ID\n\n**Your name matters:** Make sure it's set before sending invites so recipients know who is requesting their location.",
  },

  // ── PRIVACY & SECURITY ──────────────────────────────────────────────────────
  {
    patterns: [/priv|secure|security|safe|anonymous|data.*protect|protect.*data|who\s*can\s*see|track.*without\s*(consent|permission|knowing)|spy|surveillance|can\s*(they|contact)\s*see\s*me|is\s*(it|this)\s*safe/i],
    response: "🔒 **Privacy & Security:**\n\n**Explicit consent always required:**\n• Nobody can be tracked without tapping the consent link AND actively tapping Grant Access\n• The link is unique per invite — cannot be guessed or brute-forced\n\n**Data access:**\n• Location data is only visible to the person who sent the invite\n• Other users cannot see your contacts' data\n• GeoBoard photos/video are only visible to the invite sender\n\n**Revocation:**\n• The recipient can close their browser tab to stop sharing (location updates stop)\n• The sender can revoke access at any time from the Permissions page\n\n**No background tracking:**\n• Sharing only happens while the consent page is open in the browser\n• PhoneLink does not install anything on the recipient's device\n\n**Data:** PhoneLink does not sell or share your data.",
  },

  // ── STALENESS ALERTS ────────────────────────────────────────────────────────
  {
    patterns: [/stale|stalenesss?|offline|not\s*updat|last\s*seen|inactive|stopped\s*(sharing|updating)|contact\s*(offline|inactive|not\s*respond)|location\s*old|out\s*of\s*date|5\s*minute/i],
    response: "⏰ **Staleness Alerts — Offline Contact Detection:**\n\nIf a contact's location hasn't updated for **5 minutes**, you receive a push notification:\n\"⚠️ [Name] hasn't sent a location update recently.\"\n\n**Common reasons:**\n• They closed the browser tab with the consent page\n• Phone screen timed out and the browser went to sleep\n• They lost GPS/internet signal\n• The tab was refreshed or navigated away\n\n**The alert fires once** per offline period — no repeated spam.\n\n**When they come back online:** As soon as a fresh location arrives, the staleness state clears automatically and their marker on the Live Map updates.\n\n**Tip for recipients:** Keep the consent page as an open pinned tab for continuous sharing.",
  },

  // ── WHATSAPP ────────────────────────────────────────────────────────────────
  {
    patterns: [/whatsapp|wa\.me|send.*whatsapp|open.*whatsapp|whatsapp.*link|whatsapp.*message|message.*whatsapp/i],
    response: "💬 **WhatsApp Integration:**\n\nPhoneLink uses WhatsApp as the delivery channel for consent links — no SMS costs, no app install for recipients.\n\n**How it works:**\n1. You compose the invite in PhoneLink\n2. Tap Send via WhatsApp — your WhatsApp app opens with the message + link already written\n3. You just hit Send inside WhatsApp\n\n**The message:** Pre-filled with a friendly, conversational text — \"Yo, you gotta check this out…\" — that doesn't look like a tracking link.\n\n**The link is short:** e.g. `yourapp.replit.app/consent/aB3xK9mQ` — 8-character token, looks clean in chat.\n\n**Go Back button:** After the recipient grants access, the Go Back button on the consent page returns them straight to WhatsApp — location keeps running in the background.",
  },

  // ── MAP QUALITY / SATELLITE ─────────────────────────────────────────────────
  {
    patterns: [/satellite|map\s*(quality|tile|blurr|sharp|detail|clear|zoom)|blur|blurr|tile|imagery|zoom\s*(level|in|out|more)|how\s*(close|far)\s*can\s*i\s*zoom|street\s*level|high.*detail/i],
    response: "🛰️ **Map Imagery & Zoom:**\n\nPhoneLink renders satellite maps using two separate Google tile layers:\n\n• **Satellite layer** (`lyrs=s`) — pure photographic imagery, maximum resolution, no blending artifacts\n• **Labels layer** (`lyrs=h`) — roads, street names, and place names rendered on top with crisp vector graphics\n\nThis split-layer approach gives much sharper results than the blended `lyrs=y` tile.\n\n**Zoom levels:**\n• Max native tile zoom: **21** (fetches highest-resolution tiles available)\n• Manual zoom goes to **22** before upscaling\n• Single contact view: zooms to level **19** automatically\n• Trail view: fits all points with 5% padding, up to zoom **20**\n\n**The orange/warm tint** you may see in some areas is the actual color of the satellite imagery for that region — it's real photography, not a rendering issue.",
  },

  // ── CONSENT LINK / SHORT TOKEN ──────────────────────────────────────────────
  {
    patterns: [/consent\s*link|link\s*long|shorten|short\s*link|token|link\s*look|what\s*does.*link\s*look|url|link\s*format/i],
    response: "🔗 **Consent Link Format:**\n\nConsent links are short and clean:\n`https://yourapp.replit.app/consent/aB3xK9mQ`\n\nThe 8-character token (e.g. `aB3xK9mQ`) is randomly generated using base64url encoding — secure but not excessively long.\n\n**Why short?** Long UUID links (like `...consent/dbe1663d-a0de-49fd-...`) look suspicious in WhatsApp. The short token looks like a normal link.\n\n**Is it secure?** Yes — 8 base64url characters = 48 bits of randomness. An attacker would need to try billions of combinations to guess one.",
  },

  // ── MULTIPLE CONTACTS ───────────────────────────────────────────────────────
  {
    patterns: [/multiple\s*(contact|people|person)|more\s*than\s*one\s*(contact|person)|track\s*(many|several|multiple)|how\s*many\s*(contact|people)|family|group\s*tracking|add\s*(more|another|multiple)/i],
    response: "👥 **Tracking Multiple Contacts:**\n\nPhoneLink supports unlimited contacts — invite as many people as you need.\n\n**Each contact:**\n• Gets their own unique consent link\n• Has their own marker on the Live Map (color-coded by name)\n• Has their own location history trail\n• Can be individually managed in Permissions\n\n**Live Map** automatically fits all contact markers in view.\n\n**Geofences** can be assigned to multiple contacts at once — you'll get separate alerts for each person.\n\n**Family setup tip:** Send invites to each family member individually. Use their names when composing invites so you can identify each one on the map.",
  },

  // ── RECIPIENT HAS NO APP ────────────────────────────────────────────────────
  {
    patterns: [/do\s*they\s*need|need.*app|install.*app|download.*app|no.*app|without.*app|app.*required|does.*recipient.*need|recipient.*install/i],
    response: "📲 **Does the Recipient Need an App?**\n\n**No!** The recipient doesn't need to install anything.\n\nThey just:\n1. Tap the WhatsApp link\n2. It opens in their browser (Chrome, Safari, Firefox — any mobile browser)\n3. Tap Grant Access and allow GPS\n4. Done — they're sharing location\n\nNo account, no download, no signup required. The whole flow works 100% in the browser.\n\n**What they need:**\n• A smartphone with a browser\n• Location (GPS) permission allowed in the browser\n• Camera permission (for GeoBoard photos/video)\n• The browser tab kept open for continuous sharing",
  },

  // ── HOW LONG DOES SHARING LAST ──────────────────────────────────────────────
  {
    patterns: [/how\s*long\s*(does|will|is)\s*(sharing|location|it)\s*(last|continue|run|go|work)|duration.*sharing|sharing.*duration|expire|expir|when\s*(does|will)\s*(it|sharing)\s*(stop|end)|stop\s*sharing\s*automatically|automatic.*stop/i],
    response: "⏱️ **How Long Does Sharing Last?**\n\nSharing continues as long as the **consent page tab is open** in the recipient's browser.\n\n**It stops when:**\n• They close the tab or browser\n• The browser kills the tab (e.g. low memory on mobile)\n• You revoke their access from the Permissions page\n• They navigate away from the consent page\n\n**It keeps going when:**\n• They switch to other apps (location updates in background)\n• They lock the screen (as long as browser stays open)\n• They're on a phone call\n\n**Tip:** The consent page says \"Keep this page open\" — pinning it as a browser tab is the most reliable way to maintain continuous sharing.\n\n**There is no automatic expiry** — sharing lasts until stopped manually.",
  },

  // ── CONSENT PAGE NOT LOADING ────────────────────────────────────────────────
  {
    patterns: [/consent\s*page\s*(not|doesn'?t)\s*(load|work|open)|link\s*(not|doesn'?t)\s*(work|open|load)|broken\s*link|invalid\s*(link|token)|link\s*(broken|invalid|expired)|can'?t\s*open\s*link/i],
    response: "🔧 **Consent Link Not Working:**\n\n**Most common causes:**\n\n1. **Invite was deleted** — if the invite was removed from PhoneLink, the link is invalidated. Send a new invite.\n\n2. **Already accepted** — the link can only be accepted once. If status shows \"accepted\", the contact is already sharing.\n\n3. **Typo in the link** — make sure the full URL was sent, not cut off by WhatsApp.\n\n4. **App/server restart** — in development, a server restart doesn't affect the database. Links should still work.\n\n**Fix:** Go to Invites → delete the old invite → send a new one with a fresh link.",
  },

  // ── TROUBLESHOOTING: CONTACT NOT ON MAP ────────────────────────────────────
  {
    patterns: [/contact\s*(not\s*on|not\s*showing|missing\s*from|not\s*appear|can'?t\s*see|not\s*visible)\s*(map|live\s*map)|not\s*showing\s*on\s*map|can'?t\s*see\s*(contact|them)\s*on\s*(map|live\s*map)|where.*contact.*map|map\s*(not\s*showing|missing)\s*contact/i],
    response: "🔧 **Contact Not Showing on Live Map:**\n\n**Check these in order:**\n\n1. **Invite status** — Invites page → is it \"accepted\"? If still \"pending\", they haven't granted yet.\n\n2. **Consent page open?** — The recipient must have the consent page open in their browser. If they closed it, location stops.\n\n3. **Staleness** — Check if the contact marker is greyed out (stale). Their last known position may still show but is outdated.\n\n4. **Map zoom** — Zoom out to see if they're visible far away, or tap the \"fit all\" button to center on all contacts.\n\n5. **Permissions** — Go to Permissions → confirm the contact shows as active (not revoked).\n\n6. **Refresh** — Tap the refresh button on the Live Map to force-pull latest data.",
  },

  // ── TROUBLESHOOTING: LOCATION NOT UPDATING ─────────────────────────────────
  {
    patterns: [/location\s*(not|isn'?t|stopped)\s*updat|not\s*updat.*location|location\s*stuck|stuck\s*(on|at)\s*(location|position)|location\s*(same|unchanged|old|wrong)|wrong\s*location|inaccurate\s*location/i],
    response: "🔧 **Location Not Updating / Wrong Location:**\n\n**For the recipient (sharer):**\n• Keep the consent page open — updates only happen while the tab is active/backgrounded\n• Check that GPS is on (location icon in status bar)\n• Go outside or near a window — indoor GPS is often inaccurate (±15-30m is normal)\n• Reload the consent page if updates seem stuck\n\n**For the sender (watcher):**\n• Tap the **refresh button** on the Live Map\n• Check the \"Last update\" timestamp on the contact marker — if it's recent, they are updating\n• A staleness alert fires if no update for 5+ minutes\n\n**Accuracy note:** The ±Xm figure shows GPS accuracy. ±8m is excellent. ±50m+ means weak GPS signal.",
  },

  // ── TROUBLESHOOTING: NOTIFICATIONS NOT WORKING ─────────────────────────────
  {
    patterns: [/(push\s*)?notif.*not\s*(work|arriv|show|appear|receiv|coming)|not\s*(getting|receiv|seeing)\s*(push\s*)?notif|notification.*broken|missing\s*notif|why\s*(am\s*i\s*not|aren'?t\s*i)\s*(getting|receiving)\s*notif/i],
    response: "🔧 **Notifications Not Working:**\n\n**Step 1 — Check PhoneLink settings:**\nSettings → Notifications → should show \"Notifications enabled ✓\"\nIf not, tap Enable and allow in the browser prompt.\n\n**Step 2 — Check browser permissions:**\n• Chrome Android: tap 🔒 in address bar → Notifications → Allow\n• Safari iOS: Settings app → Safari → [your site] → Notifications → Allow\n\n**Step 3 — Check system settings:**\n• Android: Settings → Apps → Browser → Notifications → Enable\n• iOS: Settings → Notifications → [Browser] → Allow Notifications\n\n**Step 4 — Do Not Disturb:**\nMake sure DND / Focus mode is off.\n\n**Step 5 — Re-subscribe:**\nSettings → Notifications → Disable → re-Enable. This re-registers your push subscription.",
  },

  // ── TROUBLESHOOTING: CAMERA / GEOBOARD NOT WORKING ────────────────────────
  {
    patterns: [/camera\s*(not|permission|access|denied|block|won'?t|doesn'?t)\s*(work|open|allow|grant)|geoboard\s*(not|failed|error|broken|doesn'?t)\s*(work|capture|saving|save)|photo\s*(not|failed|error)\s*(captur|sav|work)|can'?t\s*(access|use)\s*camera/i],
    response: "🔧 **Camera / GeoBoard Not Working:**\n\n**Most likely: camera permission was denied.**\n\n**Fix on Android (Chrome):**\n1. Tap 🔒 in the address bar\n2. Tap Permissions\n3. Camera → Allow\n4. Reload the consent page\n\n**Fix on iOS (Safari):**\n1. Settings app → Privacy & Security → Camera\n2. Find Safari → Enable\n3. OR: Settings → Safari → [site] → Camera → Allow\n\n**After fixing permissions:** Reload the consent page. GeoBoard captures trigger automatically after location is granted — you'll see the camera progress bar start again.\n\n**Note:** If photos/video still don't capture, the device may not have a front camera or the browser may not support WebRTC. GeoBoard degrades gracefully — location sharing still works.",
  },

  // ── SHARED COORDINATES PAGE ─────────────────────────────────────────────────
  {
    patterns: [/shared\s*coord|share.*coord|coord.*share|share.*position|share.*location.*link|send\s*(my|a)\s*location|share\s*(my\s*)?location\s*(link|url)/i],
    response: "📌 **Sharing Your Own Coordinates:**\n\nPhoneLink has a **Shared Coordinates** page where you can:\n• See your current GPS position\n• Copy coordinates to share with anyone\n• Open your location in Google Maps\n• Generate a shareable position link\n\nAccess it from the navigation menu → Shared Coordinates (or location pin icon).\n\nThis is different from the consent-based tracking — it's for quickly sharing your own position as a one-time snapshot, not continuous tracking.",
  },

  // ── HOW LOCATION IS SENT ────────────────────────────────────────────────────
  {
    patterns: [/how\s*(does|do|is)\s*location\s*(send|sent|push|updat|transmit|work|get\s*to)|location\s*update\s*(interval|frequency|how\s*often|every)|how\s*often.*update|update.*every|frequency.*updat|interval.*updat/i],
    response: "📡 **How Location Updates Work:**\n\n**On the recipient's device (sharer):**\n• The browser's Geolocation API watches GPS continuously\n• New positions are sent to the PhoneLink server via HTTP POST to `/api/location/push`\n• Updates fire on significant movement (or at least every ~10-30 seconds)\n\n**On your device (watcher):**\n• The Live Map polls or receives live updates\n• The \"Last update\" timestamp and \"Updates sent\" counter on the consent page show activity\n\n**Accuracy:** Uses GPS first (most accurate), falls back to WiFi positioning, then cell tower. The ±Xm badge shows the margin.\n\n**Data used:** Each location update is a tiny JSON payload (~200 bytes). Very low data usage.",
  },

  // ── DASHBOARD ───────────────────────────────────────────────────────────────
  {
    patterns: [/dashboard|home\s*(screen|page)|main\s*(screen|page)|landing|overview\s*page|what\s*(is|does)\s*(the\s*)?(home|dashboard|main)/i],
    response: "🏠 **Dashboard / Home Screen:**\n\nThe PhoneLink dashboard gives you a quick overview:\n\n• 📊 **Active contacts** — how many people are currently sharing location\n• 🔔 **Unread alerts** — push notifications waiting to be reviewed\n• 📨 **Pending invites** — invites sent but not yet accepted\n• 🗺️ Quick access to **Live Map**\n• 📸 Quick access to **GeoBoard**\n• 🚨 **SOS button** (always accessible)\n\nTap any card to dive into that section.",
  },

  // ── NOTIFICATIONS BADGE ─────────────────────────────────────────────────────
  {
    patterns: [/notification\s*(badge|count|number|red\s*dot|bell|icon)|bell\s*(icon|badge|number|red)|red\s*dot\s*(on|next\s*to)\s*(bell|notif)|unread\s*(notif|count|badge)/i],
    response: "🔔 **Notification Badge (Bell Icon):**\n\nThe bell icon in the top-right shows a red badge with the count of unread notifications.\n\n**Tap the bell** to open the notification center — see all recent alerts:\n• ✅ Contact granted access\n• ⏰ Staleness alerts\n• 📍 Geofence triggers\n• 🚨 SOS events\n\nThe badge clears once you open and view the notifications.\n\nThe count updates automatically in the background — the app polls for new unread notifications regularly.",
  },

  // ── PRICING / COST ──────────────────────────────────────────────────────────
  {
    patterns: [/price|pricing|cost|free|pay|subscription|how\s*much|paid|premium|plan/i],
    response: "💰 **PhoneLink Pricing:**\n\nPhoneLink is currently free to use. All features — Live Map, GeoBoard, Geofences, SOS, push notifications, unlimited contacts — are available at no cost.\n\nThere are no subscription tiers, no paywalls, and no in-app purchases at this time.",
  },

  // ── DARK MODE / THEME ───────────────────────────────────────────────────────
  {
    patterns: [/dark\s*mode|light\s*mode|theme|colour\s*scheme|color\s*scheme|appearance|black\s*(background|theme)|white\s*(background|theme)|switch.*theme|change.*theme/i],
    response: "🎨 **Theme / Dark Mode:**\n\nPhoneLink supports both dark and light themes.\n\n**To switch:**\nGo to **Settings → Appearance** and toggle between Dark and Light mode.\n\nThe default is dark mode — easier on the eyes for monitoring locations at night.",
  },

  // ── LANGUAGE ────────────────────────────────────────────────────────────────
  {
    patterns: [/language|translate|spanish|french|arabic|portuguese|swahili|local\s*language|multi.?language|internation/i],
    response: "🌐 **Language Support:**\n\nPhoneLink's interface is currently in **English**.\n\nMulti-language support is not yet available, but the consent page and invite messages can be written in any language — just edit the message text in the Invites form before sending via WhatsApp.",
  },

  // ── ACCOUNT / LOGIN ─────────────────────────────────────────────────────────
  {
    patterns: [/account|login|log\s*in|sign\s*in|sign\s*up|register|authentication|password|how\s*(do\s*i\s*)?(create|make|get)\s*(an?\s*)?account/i],
    response: "🔐 **Account & Login:**\n\nPhoneLink uses a lightweight local account system:\n\n• Open the app → enter your **name** on the profile/onboarding screen\n• Your user ID is stored locally in the browser (no password required)\n• You stay logged in as long as you use the same browser on the same device\n\n**No email, no password, no OTP** — it's frictionless.\n\n**Switching devices:** Currently, accounts don't sync across devices. Use the same browser/device for the best experience.\n\n**For the recipient:** No account is needed at all — they just tap the link.",
  },

  // ── LIVE SHARING STATUS (ON CONSENT PAGE) ──────────────────────────────────
  {
    patterns: [/live\s*sharing\s*(screen|page|status)|sharing\s*(screen|page|status|active)|what\s*(is|does)\s*(the\s*)?live\s*sharing\s*(screen|page|show)|green\s*(dot|pulse|light|circle)|pulsing\s*(dot|green)/i],
    response: "🟢 **LIVE SHARING Screen:**\n\nWhen the recipient grants access, the consent page switches to the **LIVE SHARING** view:\n\n• 🟢 **Pulsing green dot** — confirms location is actively transmitting\n• 📸 **GeoBoard progress** — shows photo capture and video recording bars\n• 📍 **Current Position** — live coordinates + accuracy + address\n• 🔢 **Updates sent** — count of location pushes sent so far\n• 🕐 **Last update** — exact time of most recent push\n• ✅ **Live sharing is active** — reminder to keep the page open\n• ⬅️ **Go Back** — returns to WhatsApp (sharing continues in background)\n\nThe page auto-refreshes the position display as new GPS readings come in.",
  },

  // ── HELP / WHAT CAN YOU DO ─────────────────────────────────────────────────
  {
    patterns: [/help|what\s*can\s*(you|i)\s*(do|ask|help)|what\s*do\s*you\s*know|capabilities|features?\s*(list|all)|list.*feature|all.*feature|tell\s*me\s*everything/i],
    response: "🤖 **What I Can Help With:**\n\nI know everything about PhoneLink. Ask me about:\n\n📱 **The App**\n• What is PhoneLink / How does it work\n• Getting started guide\n• Account & login\n\n📨 **Invites & Consent**\n• How to send an invite via WhatsApp\n• What the recipient sees on the consent page\n• Invite status (pending/accepted/declined)\n• Consent link format & security\n\n🗺️ **Tracking**\n• Live Map — real-time contact positions\n• Location History — movement trail replay\n• Location update frequency\n• Satellite map quality & zoom\n\n📸 **GeoBoard**\n• Auto photo capture (5 photos)\n• Auto video recording (5 seconds)\n\n🛡️ **Safety**\n• SOS emergency alert\n• Geofences — entry/exit alerts\n• Staleness detection (5-minute alert)\n\n🔔 **Notifications**\n• Push notification setup\n• All alert types\n\n🔧 **Troubleshooting**\n• Contact not on map\n• Location not updating\n• Notifications not working\n• Camera / GeoBoard issues\n\nJust ask naturally — \"How do I invite someone?\" or \"What is GeoBoard?\"",
  },

  // ── THANKS / GOODBYE ────────────────────────────────────────────────────────
  {
    patterns: [/thank|thanks|thx|thank\s*you|ty\b|appreciate|cheers|great|awesome|perfect|nice|cool|bye|goodbye|see\s*ya|later|cya|good\s*(bye|one)|that'?s?\s*(all|it|helpful)/i],
    response: "You're welcome! 😊 Stay safe out there — that's what PhoneLink is for. 🛡️\n\nIf you ever need help again, just tap the bot button and ask away!",
  },
];

const FALLBACK =
  "🤔 I'm not sure about that specific question. Here's a quick menu of what I know:\n\n📨 **Invites** — \"How do I invite someone?\"\n🗺️ **Live Map** — \"How does real-time tracking work?\"\n📸 **GeoBoard** — \"What are the auto-photos?\"\n🚨 **SOS** — \"How do I send an emergency alert?\"\n📍 **Geofences** — \"How do I set up a zone alert?\"\n🔔 **Notifications** — \"Why am I not getting alerts?\"\n🔒 **Privacy** — \"Is tracking anonymous?\"\n🔧 **Troubleshooting** — \"Contact not showing on map\"\n\nTry asking in a different way, or pick a topic above!";

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

router.post("/assistant", (req, res) => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const reply = findResponse(parsed.data.message);
  res.json({ reply });
});

router.get("/assistant/history", (_req, res) => {
  res.json({ messages: [] });
});

export default router;
