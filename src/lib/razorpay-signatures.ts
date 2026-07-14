import { createHmac, timingSafeEqual } from "node:crypto";

function verifyHmac(payload: string, secret: string, signature: string) {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const actualBuffer = Buffer.from(signature.toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifyCheckoutHmac(orderId: string, paymentId: string, secret: string, signature: string) {
  return verifyHmac(`${orderId}|${paymentId}`, secret, signature);
}

export function verifyWebhookHmac(rawBody: string, secret: string, signature: string) {
  return verifyHmac(rawBody, secret, signature);
}
