import { Router, type IRouter } from "express";
import { GenerateWhatsappLinkBody, GenerateWhatsappLinkResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/whatsapp/link", async (req, res): Promise<void> => {
  const parsed = GenerateWhatsappLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { phoneNumber, message } = parsed.data;
  const digits = phoneNumber.replace(/[^\d]/g, "");
  const encoded = encodeURIComponent(message);
  const link = `https://wa.me/${digits}?text=${encoded}`;

  res.json(
    GenerateWhatsappLinkResponse.parse({ link, phoneNumber, message }),
  );
});

export default router;
