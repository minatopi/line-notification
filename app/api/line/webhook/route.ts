import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";


/* =========================================================
   LINE署名確認
   ========================================================= */

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
   LINEへ返信
   ========================================================= */

async function replyToLine(
  replyToken: string,
  text: string
) {
  const accessToken =
    process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN is not set"
    );
  }

  const response = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization:
          `Bearer ${accessToken}`,
      },

      body: JSON.stringify({
        replyToken,

        messages: [
          {
            type: "text",
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
      "[LINE REPLY ERROR]",
      response.status,
      body
    );

    throw new Error(
      `LINE reply error: ${response.status}`
    );
  }
}


/* =========================================================
   POST
   ========================================================= */

export async function POST(
  request: Request
) {
  try {

    console.log(
      "[LINE WEBHOOK] POST received"
    );


    /* -----------------------------------------------------
       環境変数
       ----------------------------------------------------- */

    const channelSecret =
      process.env.LINE_CHANNEL_SECRET;

    if (!channelSecret) {
      console.error(
        "[LINE WEBHOOK] LINE_CHANNEL_SECRET is not set"
      );

      return Response.json(
        {
          success: false,
          error:
            "LINE_CHANNEL_SECRET is not configured",
        },
        {
          status: 500,
        }
      );
    }


    /* -----------------------------------------------------
       LINE署名
       ----------------------------------------------------- */

    const signature =
      request.headers.get(
        "x-line-signature"
      );

    if (!signature) {
      return Response.json(
        {
          success: false,
          error:
            "x-line-signature is missing",
        },
        {
          status: 401,
        }
      );
    }


    /* -----------------------------------------------------
       生body取得
       ----------------------------------------------------- */

    const body =
      await request.text();


    /* -----------------------------------------------------
       署名確認
       ----------------------------------------------------- */

    if (
      !verifySignature(
        body,
        signature,
        channelSecret
      )
    ) {
      console.error(
        "[LINE WEBHOOK] Invalid signature"
      );

      return Response.json(
        {
          success: false,
          error:
            "Invalid signature",
        },
        {
          status: 401,
        }
      );
    }


    console.log(
      "[LINE WEBHOOK] Signature verified"
    );


    /* -----------------------------------------------------
       JSON
       ----------------------------------------------------- */

    const payload =
      JSON.parse(body);

    const events =
      payload?.events ?? [];


    console.log(
      "[LINE WEBHOOK] events:",
      events.length
    );


    /*
     * LINEの検証リクエスト
     */
    if (!events.length) {
      return Response.json({
        success: true,
      });
    }


    const supabase =
      getSupabaseAdmin();


    /* =====================================================
       各イベント
       ===================================================== */

    for (const event of events) {

      const lineUserId =
        event?.source?.userId;

      console.log(
        "[LINE EVENT TYPE]",
        event?.type
      );

      console.log(
        "[LINE USER ID]",
        lineUserId
      );


      if (!lineUserId) {
        continue;
      }


      /* ===================================================
         メッセージイベント
         =================================================== */

      if (
        event.type === "message" &&
        event.message?.type === "text"
      ) {

        const text =
          event.message.text
            ?.trim() || "";


        console.log(
          "[LINE MESSAGE]",
          text
        );


        /* ===============================================
           連携コマンド

           例：

           連携 minato
           =============================================== */

        if (
          text.startsWith("連携 ")
        ) {

          const username =
            text
              .substring(3)
              .trim();


          if (!username) {

            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                "連携するChanProユーザー名を入力してください。\n\n例：\n連携 minato"
              );
            }

            continue;
          }


          console.log(
            "[LINE LINK] username:",
            username
          );


          /* ---------------------------------------------
             ChanProユーザー検索
             --------------------------------------------- */

          const {
            data: user,
            error: userError,
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


          if (userError) {

            console.error(
              "[LINE LINK USER ERROR]",
              userError
            );

            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                "ユーザー検索中にエラーが発生しました。"
              );
            }

            continue;
          }


          if (!user) {

            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                `ChanProユーザー「${username}」が見つかりません。`
              );
            }

            continue;
          }


          /* ---------------------------------------------
             他ユーザーのLINE IDを上書き
             --------------------------------------------- */

          const {
            data: existingLineUser,
            error: existingError,
          } =
            await supabase
              .from("users")
              .select(
                "id, username"
              )
              .eq(
                "line_user_id",
                lineUserId
              )
              .neq(
                "id",
                user.id
              )
              .maybeSingle();


          if (existingError) {

            console.error(
              "[LINE LINK EXISTING ERROR]",
              existingError
            );

            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                "LINE連携の確認中にエラーが発生しました。"
              );
            }

            continue;
          }


          /*
           * すでに別のChanProユーザーに
           * このLINE IDが登録されている場合
           */
          if (existingLineUser) {

            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                "このLINEアカウントは、すでに別のChanProユーザーに連携されています。"
              );
            }

            continue;
          }


          /* ---------------------------------------------
             line_user_id保存
             --------------------------------------------- */

          const {
            error: updateError
          } =
            await supabase
              .from("users")
              .update({
                line_user_id:
                  lineUserId,
              })
              .eq(
                "id",
                user.id
              );


          if (updateError) {

            console.error(
              "[LINE LINK UPDATE ERROR]",
              updateError
            );

            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                "LINE IDの保存に失敗しました。"
              );
            }

            continue;
          }


          console.log(
            "[LINE LINK SUCCESS]",
            {
              userId: user.id,
              username: user.username,
              lineUserId,
            }
          );


          /* ---------------------------------------------
             成功返信
             --------------------------------------------- */

          if (event.replyToken) {

            await replyToLine(
              event.replyToken,
              `✅ ChanProの「${user.username}」とLINEを連携しました。\n\nこれからChanProの通知をLINEで受け取れます。`
            );

          }

          continue;
        }


        /* ===============================================
           連携確認
           =============================================== */

        if (
          text === "連携確認"
        ) {

          const {
            data: linkedUser,
            error
          } =
            await supabase
              .from("users")
              .select(
                "id, username"
              )
              .eq(
                "line_user_id",
                lineUserId
              )
              .maybeSingle();


          if (error) {

            console.error(
              "[LINE LINK CHECK ERROR]",
              error
            );

            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                "連携情報の取得に失敗しました。"
              );
            }

            continue;
          }


          if (!linkedUser) {

            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                "このLINEアカウントはChanProと連携されていません。\n\n「連携 ユーザー名」と送信してください。"
              );
            }

            continue;
          }


          if (event.replyToken) {
            await replyToLine(
              event.replyToken,
              `現在、ChanProの「${linkedUser.username}」と連携されています。`
            );
          }

          continue;
        }
      }


      /* ===================================================
         その他イベント
         =================================================== */

      console.log(
        "[LINE EVENT]",
        JSON.stringify(event)
      );
    }


    /* =====================================================
       LINEには必ず200
       ===================================================== */

    return Response.json({
      success: true,
    });

  } catch (error) {

    console.error(
      "[LINE WEBHOOK ERROR]",
      error
    );

    /*
     * LINE側のWebhook検証では
     * サーバーエラーを隠さずログへ出す。
     */
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
      }
    );
  }
}


/* =========================================================
   GET
   ========================================================= */

export async function GET() {
  return Response.json({
    success: true,
    service: "ChanPro LINE Webhook",
    message:
      "LINEからのWebhookを受け付けます。",
  });
}
