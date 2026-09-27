import { createClient } from "@supabase/supabase-js";

type NotificationRecord = {
  id?: string;
  user_id?: string | null;
  actor_id?: string | null;
  type?: string | null;
  post_id?: string | null;
  message_id?: string | null;
  message?: string | null;
  created_at?: string | null;
  is_read?: boolean | null;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set"
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set"
    );
  }

  return createClient(
    url,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function notificationText(
  notification: NotificationRecord,
  actorName: string
) {
  const name = actorName || "誰か";

  const type = notification.type || "";

  switch (true) {
    case type === "like":
      return `❤️ ${name}さんがあなたの投稿にいいねしました`;

    case type === "reply":
      return `💬 ${name}さんがあなたの投稿に返信しました`;

    case type === "repost":
      return `🔁 ${name}さんがあなたの投稿をリポストしました`;

    case type === "follow":
      return `👤 ${name}さんがあなたをフォローしました`;

    case type === "post":
      return `📝 ${name}さんが新しい投稿をしました`;

    case type === "message":
      return `✉️ ${name}さんからメッセージが届きました`;

    case type === "like-project":
      return `❤️ ${name}さんがあなたのプロジェクトにいいねしました`;

    case type === "program_like":
      return `❤️ ${name}さんのプロジェクトにいいねが増えました`;

    default:
      return (
        notification.message ||
        "ChanProから新しい通知があります"
      );
  }
}

export async function POST(request: Request) {
  try {
    const webhookSecret =
      process.env.SUPABASE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error(
        "SUPABASE_WEBHOOK_SECRET is not set"
      );

      return new Response(
        "Server configuration error",
        {
          status: 500,
        }
      );
    }

    const receivedSecret =
      request.headers.get(
        "x-supabase-webhook-secret"
      );

    if (
      !receivedSecret ||
      receivedSecret !== webhookSecret
    ) {
      return new Response("Unauthorized", {
        status: 401,
      });
    }

    const payload = await request.json();

    const notification =
      payload?.record as NotificationRecord | undefined;

    if (!notification) {
      return Response.json(
        {
          success: false,
          error: "record is missing",
        },
        {
          status: 400,
        }
      );
    }

    if (!notification.user_id) {
      return Response.json({
        success: true,
        skipped: true,
        reason: "notification has no user_id",
      });
    }

    const supabase = getSupabaseAdmin();

    // 通知を受け取るユーザー
    const { data: recipient, error: recipientError } =
      await supabase
        .from("users")
        .select(
          "id, username, line_user_id"
        )
        .eq("id", notification.user_id)
        .maybeSingle();

    if (recipientError) {
      console.error(
        "Recipient lookup error:",
        recipientError
      );

      return new Response(
        "Recipient lookup failed",
        {
          status: 500,
        }
      );
    }

    if (!recipient) {
      return Response.json({
        success: true,
        skipped: true,
        reason: "recipient not found",
      });
    }

    if (!recipient.line_user_id) {
      return Response.json({
        success: true,
        skipped: true,
        reason: "LINE is not linked",
        user_id: recipient.id,
      });
    }

    // 通知を発生させたユーザー
    let actorName = "";

    if (notification.actor_id) {
      const { data: actor } =
        await supabase
          .from("users")
          .select("username")
          .eq(
            "id",
            notification.actor_id
          )
          .maybeSingle();

      actorName =
        actor?.username || "";
    }

    const text = notificationText(
      notification,
      actorName
    );

    const accessToken =
      process.env.LINE_CHANNEL_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error(
        "LINE_CHANNEL_ACCESS_TOKEN is not set"
      );
    }

    const lineResponse = await fetch(
      "https://api.line.me/v2/bot/message/push",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${accessToken}`,
        },

        body: JSON.stringify({
          to: recipient.line_user_id,

          messages: [
            {
              type: "text",
              text,
            },
          ],
        }),
      }
    );

    const lineBody =
      await lineResponse.text();

    if (!lineResponse.ok) {
      console.error(
        "LINE API error:",
        lineResponse.status,
        lineBody
      );

      return new Response(
        "LINE API error",
        {
          status: 502,
        }
      );
    }

    console.log(
      "LINE notification sent:",
      recipient.username,
      text
    );

    return Response.json({
      success: true,
      sent: true,
      user_id: recipient.id,
      username: recipient.username,
      notification_id:
        notification.id ?? null,
    });

  } catch (error) {
    console.error(
      "LINE notification error:",
      error
    );

    return new Response(
      "Internal Server Error",
      {
        status: 500,
      }
    );
  }
}