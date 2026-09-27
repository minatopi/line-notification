import crypto from "crypto";

function verifySignature(
  body: string,
  signature: string,
  secret: string
) {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.text();

    const signature =
      request.headers.get("x-line-signature");

    const channelSecret =
      process.env.LINE_CHANNEL_SECRET;

    if (!channelSecret) {
      console.error("LINE_CHANNEL_SECRET is not set");

      return new Response("Server configuration error", {
        status: 500,
      });
    }

    if (!signature) {
      return new Response("Missing signature", {
        status: 401,
      });
    }

    if (
      !verifySignature(
        body,
        signature,
        channelSecret
      )
    ) {
      return new Response("Invalid signature", {
        status: 401,
      });
    }

    const payload = JSON.parse(body);

    for (const event of payload.events ?? []) {
      const userId = event?.source?.userId;

      if (userId) {
        console.log(
          "[LINE USER ID]",
          userId
        );
      }

      console.log(
        "[LINE EVENT]",
        JSON.stringify(event)
      );
    }

    return Response.json({
      success: true,
    });

  } catch (error) {
    console.error(
      "LINE webhook error:",
      error
    );

    return new Response("Internal Server Error", {
      status: 500,
    });
  }
}