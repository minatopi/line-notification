import crypto from "crypto";

function verifySignature(
  body: string,
  signature: string,
  channelSecret: string
) {
  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(body)
    .digest("base64");

  const a = Buffer.from(hash);
  const b = Buffer.from(signature);

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  try {
    console.log("[LINE WEBHOOK] POST received");

    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!channelSecret) {
      console.error(
        "[LINE WEBHOOK] LINE_CHANNEL_SECRET is not set"
      );

      return Response.json(
        {
          success: false,
          error: "LINE_CHANNEL_SECRET is not configured",
        },
        {
          status: 500,
        }
      );
    }

    const signature =
      request.headers.get("x-line-signature");

    if (!signature) {
      console.error(
        "[LINE WEBHOOK] x-line-signature is missing"
      );

      return Response.json(
        {
          success: false,
          error: "x-line-signature is missing",
        },
        {
          status: 401,
        }
      );
    }

    // 署名検証前にbodyをJSON化しない
    const body = await request.text();

    const valid = verifySignature(
      body,
      signature,
      channelSecret
    );

    if (!valid) {
      console.error(
        "[LINE WEBHOOK] Invalid signature"
      );

      return Response.json(
        {
          success: false,
          error: "Invalid signature",
        },
        {
          status: 401,
        }
      );
    }

    console.log(
      "[LINE WEBHOOK] Signature verified"
    );

    const payload = JSON.parse(body);

    console.log(
      "[LINE WEBHOOK] events:",
      payload.events?.length ?? 0
    );

    // LINEの疎通確認
    // events=[] の場合も必ず200を返す
    if (!Array.isArray(payload.events)) {
      return Response.json({
        success: true,
      });
    }

    for (const event of payload.events) {
      const lineUserId =
        event?.source?.userId;

      console.log(
        "[LINE EVENT TYPE]",
        event?.type
      );

      if (lineUserId) {
        console.log(
          "[LINE USER ID]",
          lineUserId
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
      "[LINE WEBHOOK ERROR]",
      error
    );

    return Response.json(
      {
        success: false,
        error: "Internal Server Error",
      },
      {
        status: 500,
      }
    );
  }
}
