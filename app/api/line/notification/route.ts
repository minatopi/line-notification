import { createClient } from "@supabase/supabase-js";


/* =========================================================
   CORS
   ========================================================= */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, x-supabase-webhook-secret",
  "Access-Control-Max-Age": "86400",
};


/* =========================================================
   OPTIONS
   ========================================================= */

export async function OPTIONS() {

  return new Response(
    null,
    {
      status: 204,
      headers: corsHeaders,
    }
  );
}


/* =========================================================
   型
   ========================================================= */

type NotificationRecord = {
  id?: string | null;
  user_id?: string | null;
  actor_id?: string | null;
  type?: string | null;
  post_id?: string | null;
  message_id?: string | null;
  created_at?: string | null;
  is_read?: boolean | null;
  message?: string | null;
};


type TestRequest = {
  username?: string;
  message?: string;
};


/* =========================================================
   Supabase Admin
   ========================================================= */

function getSupabaseAdmin() {

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

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


/* =========================================================
   Webhook Secret
   ========================================================= */

function checkWebhookSecret(
  request: Request
) {

  const expected =
    process.env.SUPABASE_WEBHOOK_SECRET;


  if (!expected) {
    throw new Error(
      "SUPABASE_WEBHOOK_SECRET is not set"
    );
  }


  const received =
    request.headers.get(
      "x-supabase-webhook-secret"
    );


  return (
    !!received &&
    received === expected
  );
}


/* =========================================================
   LINE送信
   ========================================================= */

async function sendLineMessage(
  lineUserId: string,
  text: string
) {

  const accessToken =
    process.env.LINE_CHANNEL_ACCESS_TOKEN;


  if (!accessToken) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN is not set"
    );
  }


  const response =
    await fetch(
      "https://api.line.me/v2/bot/message/push",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${accessToken}`,
        },

        body:
          JSON.stringify({
            to:
              lineUserId,

            messages: [
              {
                type:
                  "text",

                text,
              },
            ],
          }),
      }
    );


  const body =
    await response.text();


  if (!response.ok) {

    console.error(
      "[LINE API ERROR]",
      response.status,
      body
    );

    throw new Error(
      `LINE API error: ${response.status}`
    );
  }


  console.log(
    "[LINE API] message sent",
    lineUserId
  );


  return true;
}


/* =========================================================
   通知本文
   ========================================================= */

function createNotificationText(
  notification: NotificationRecord,
  actorName: string
) {

  const name =
    actorName ||
    "ユーザー";

  const type =
    notification.type ||
    "";


  /* DM */

  if (
    type === "message"
  ) {

    return (
      `✉️ ${name}さんからDMが届きました`
    );
  }


  /* いいね */

  if (
    type === "like"
  ) {

    return (
      `❤️ ${name}さんがあなたの投稿にいいねしました`
    );
  }


  /* 返信 */

  if (
    type === "reply"
  ) {

    return (
      `💬 ${name}さんがあなたの投稿に返信しました`
    );
  }


  /* リポスト */

  if (
    type === "repost"
  ) {

    return (
      `🔁 ${name}さんがあなたの投稿をリポストしました`
    );
  }


  /* フォロー */

  if (
    type === "follow"
  ) {

    return (
      `👤 ${name}さんがあなたをフォローしました`
    );
  }


  /* 新規投稿 */

  if (
    type === "post"
  ) {

    return (
      `📝 ${name}さんが新しい投稿をしました`
    );
  }


  /* プロジェクトいいね */

  if (
    type === "like-project"
  ) {

    return (
      `❤️ ${name}さんが${
        notification.message ||
        "あなたのプロジェクトにいいねしました"
      }`
    );
  }


  /* プロジェクトいいね増加 */

  if (
    type === "program_like" ||
    type.startsWith(
      "program_like|"
    )
  ) {

    const parts =
      type.split("|");

    const count =
      parseInt(
        parts[2],
        10
      );


    if (
      !Number.isNaN(count)
    ) {

      return (
        `❤️ ${name}さんのプロジェクトにいいねが ${count}件増えました`
      );
    }


    return (
      `❤️ ${name}さんのプロジェクトにいいねが増えました`
    );
  }


  /* その他 */

  if (
    notification.message &&
    notification.message.trim()
  ) {

    return notification.message;
  }


  return (
    `🔔 ${name}さんから新しい通知があります`
  );
}


/* =========================================================
   POST
   ========================================================= */

export async function POST(
  request: Request
) {

  try {

    console.log(
      "[LINE NOTIFICATION] POST received"
    );


    /* =====================================================
       JSON
       ===================================================== */

    let payload: any;

    try {

      payload =
        await request.json();

    } catch {

      return Response.json(
        {
          success: false,
          error:
            "JSONの解析に失敗しました",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    /* =====================================================
       テスト通知
       
       username + message
       ===================================================== */

    if (
      payload &&
      typeof payload === "object" &&
      "username" in payload
    ) {

      const result =
        await handleTestNotification(
          payload as TestRequest
        );


      /*
       * handleTestNotification内部でも
       * CORSを付けている。
       */

      return result;
    }


    /* =====================================================
       Supabase Webhook
       ===================================================== */

    if (
      !checkWebhookSecret(
        request
      )
    ) {

      console.error(
        "[LINE NOTIFICATION] Invalid webhook secret"
      );


      return Response.json(
        {
          success: false,
          error:
            "Unauthorized",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }


    /* =====================================================
       notification record
       ===================================================== */

    const notification =
      payload?.record as
        | NotificationRecord
        | undefined;


    if (!notification) {

      return Response.json(
        {
          success: false,
          error:
            "record is missing",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    console.log(
      "[LINE NOTIFICATION]",
      JSON.stringify(
        notification
      )
    );


    /* =====================================================
       user_id
       ===================================================== */

    if (
      !notification.user_id
    ) {

      return Response.json(
        {
          success: true,
          sent: false,
          skipped: true,
          reason:
            "notification has no user_id",
        },
        {
          headers: corsHeaders,
        }
      );
    }


    const supabase =
      getSupabaseAdmin();


    /* =====================================================
       通知受信ユーザー
       ===================================================== */

    const {
      data: recipient,
      error: recipientError,
    } =
      await supabase
        .from("users")
        .select(
          "id, username, line_user_id"
        )
        .eq(
          "id",
          notification.user_id
        )
        .maybeSingle();


    if (recipientError) {

      console.error(
        "[RECIPIENT ERROR]",
        recipientError
      );


      return Response.json(
        {
          success: false,
          error:
            "Recipient lookup failed",
        },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }


    if (!recipient) {

      return Response.json(
        {
          success: true,
          sent: false,
          skipped: true,
          reason:
            "recipient not found",
        },
        {
          headers: corsHeaders,
        }
      );
    }


    /* =====================================================
       LINE未連携
       ===================================================== */

    if (
      !recipient.line_user_id
    ) {

      console.log(
        "[LINE NOTIFICATION] LINE not linked:",
        recipient.username
      );


      return Response.json(
        {
          success: true,
          sent: false,
          skipped: true,
          reason:
            "LINE is not linked",

          user_id:
            recipient.id,

          username:
            recipient.username,
        },
        {
          headers: corsHeaders,
        }
      );
    }


    /* =====================================================
       actor
       ===================================================== */

    let actorName =
      "";


    if (
      notification.actor_id
    ) {

      const {
        data: actor,
        error: actorError,
      } =
        await supabase
          .from("users")
          .select(
            "id, username"
          )
          .eq(
            "id",
            notification.actor_id
          )
          .maybeSingle();


      if (actorError) {

        console.error(
          "[ACTOR ERROR]",
          actorError
        );
      }


      actorName =
        actor?.username ||
        "";
    }


    /* =====================================================
       LINE本文
       ===================================================== */

    const text =
      createNotificationText(
        notification,
        actorName
      );


    console.log(
      "[LINE MESSAGE]",
      text
    );


    /* =====================================================
       LINE送信
       ===================================================== */

    await sendLineMessage(
      recipient.line_user_id,
      text
    );


    /* =====================================================
       完了
       ===================================================== */

    return Response.json(
      {
        success: true,
        sent: true,

        user_id:
          recipient.id,

        username:
          recipient.username,

        notification_id:
          notification.id ??
          null,

        type:
          notification.type ??
          null,

        message:
          text,
      },
      {
        headers: corsHeaders,
      }
    );

  } catch (error) {

    console.error(
      "[LINE NOTIFICATION ERROR]",
      error
    );


    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Internal Server Error",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}


/* =========================================================
   テスト通知
   ========================================================= */

async function handleTestNotification(
  payload: TestRequest
) {

  try {

    const username =
      payload.username?.trim();


    const message =
      payload.message?.trim();


    if (!username) {

      return Response.json(
        {
          success: false,
          error:
            "username is required",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    if (!message) {

      return Response.json(
        {
          success: false,
          error:
            "message is required",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    const supabase =
      getSupabaseAdmin();


    /* ユーザー */

    const {
      data: user,
      error
    } =
      await supabase
        .from("users")
        .select(
          "id, username, line_user_id"
        )
        .eq(
          "username",
          username
        )
        .maybeSingle();


    if (error) {

      console.error(
        "[TEST USER ERROR]",
        error
      );


      return Response.json(
        {
          success: false,
          error:
            "User lookup failed",
        },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }


    if (!user) {

      return Response.json(
        {
          success: false,
          error:
            "ChanProユーザーが見つかりません。",
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }


    if (!user.line_user_id) {

      return Response.json(
        {
          success: false,
          error:
            "このユーザーにはLINEが連携されていません。",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    /* LINE送信 */

    await sendLineMessage(
      user.line_user_id,
      message
    );


    return Response.json(
      {
        success: true,
        sent: true,

        user_id:
          user.id,

        username:
          user.username,

        message,
      },
      {
        headers: corsHeaders,
      }
    );

  } catch (error) {

    console.error(
      "[LINE TEST ERROR]",
      error
    );


    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Test notification failed",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}


/* =========================================================
   GET
   ========================================================= */

export async function GET() {

  return Response.json(
    {
      success: true,

      service:
        "ChanPro LINE Notification API",

      endpoints: {
        notification:
          "POST /api/line/notification",

        test:
          "POST /api/line/notification",
      },

      message:
        "GETはテスト用APIではありません。",
    },
    {
      headers: corsHeaders,
    }
  );
}
