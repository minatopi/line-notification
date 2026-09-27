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

  const hash =
    crypto
      .createHmac(
        "sha256",
        channelSecret
      )
      .update(body)
      .digest("base64");


  const a =
    Buffer.from(hash);

  const b =
    Buffer.from(signature);


  if (
    a.length !== b.length
  ) {
    return false;
  }


  return crypto.timingSafeEqual(
    a,
    b
  );
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
   LINE返信
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


  const response =
    await fetch(
      "https://api.line.me/v2/bot/message/reply",
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
            replyToken,

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


  const responseBody =
    await response.text();


  if (!response.ok) {

    console.error(
      "[LINE REPLY ERROR]",
      response.status,
      responseBody
    );


    throw new Error(
      `LINE reply error: ${response.status}`
    );
  }
}


/* =========================================================
   連携コード正規化
   ========================================================= */

function normalizeLinkCode(
  text: string
) {

  return text
    .trim()
    .toUpperCase()
    .replace(
      /\s+/g,
      ""
    );
}


/* =========================================================
   連携コード形式
   ========================================================= */

function isLinkCode(
  text: string
) {

  return /^CP-[A-Z0-9]{4}-[A-Z0-9]{4}$/
    .test(text);
}


/* =========================================================
   連携処理
   ========================================================= */

async function processLinkCode(
  supabase: ReturnType<
    typeof getSupabaseAdmin
  >,
  code: string,
  lineUserId: string,
  replyToken?: string
) {

  const normalizedCode =
    normalizeLinkCode(code);


  console.log(
    "[LINE LINK CODE]",
    normalizedCode
  );


  /* =====================================================
     コード検索
     ===================================================== */

  const {
    data: linkCode,
    error: codeError
  } =
    await supabase
      .from("line_link_codes")
      .select(
        `
        id,
        user_id,
        code,
        expires_at,
        used_at
        `
      )
      .eq(
        "code",
        normalizedCode
      )
      .is(
        "used_at",
        null
      )
      .gt(
        "expires_at",
        new Date().toISOString()
      )
      .maybeSingle();


  if (codeError) {

    console.error(
      "[LINE LINK CODE ERROR]",
      codeError
    );


    if (replyToken) {

      await replyToLine(
        replyToken,
        "連携コードの確認中にエラーが発生しました。"
      );
    }


    return;
  }


  /* =====================================================
     無効コード
     ===================================================== */

  if (!linkCode) {

    if (replyToken) {

      await replyToLine(
        replyToken,
        "❌ 連携コードが無効です。\n\nコードの有効期限が切れているか、すでに使用されています。\nChanProで新しい連携コードを発行してください。"
      );
    }


    return;
  }


  /* =====================================================
     現在のLINE IDが別ユーザーに
     登録されていないか確認
     ===================================================== */

  const {
    data: existingLineUser,
    error: existingError
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
        linkCode.user_id
      )
      .maybeSingle();


  if (existingError) {

    console.error(
      "[LINE EXISTING LINK ERROR]",
      existingError
    );


    if (replyToken) {

      await replyToLine(
        replyToken,
        "現在のLINE連携状態を確認できませんでした。"
      );
    }


    return;
  }


  if (existingLineUser) {

    if (replyToken) {

      await replyToLine(
        replyToken,
        `このLINEアカウントは、すでにChanProの「${existingLineUser.username}」に連携されています。\n\n先に現在の連携を解除してから、別のユーザーへ連携してください。`
      );
    }


    return;
  }


  /* =====================================================
     ChanProユーザー取得
     ===================================================== */

  const {
    data: user,
    error: userError
  } =
    await supabase
      .from("users")
      .select(
        `
        id,
        username,
        line_user_id
        `
      )
      .eq(
        "id",
        linkCode.user_id
      )
      .maybeSingle();


  if (userError) {

    console.error(
      "[LINE USER ERROR]",
      userError
    );


    if (replyToken) {

      await replyToLine(
        replyToken,
        "ChanProユーザーの確認に失敗しました。"
      );
    }


    return;
  }


  if (!user) {

    if (replyToken) {

      await replyToLine(
        replyToken,
        "連携対象のChanProユーザーが見つかりません。"
      );
    }


    return;
  }


  /* =====================================================
     すでに同じLINE IDが登録されている
     ===================================================== */

  if (
    user.line_user_id &&
    user.line_user_id === lineUserId
  ) {

    /*
     * コードは使用済みにする。
     */

    await supabase
      .from("line_link_codes")
      .update({
        used_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        linkCode.id
      )
      .is(
        "used_at",
        null
      );


    if (replyToken) {

      await replyToLine(
        replyToken,
        `このLINEアカウントは、すでにChanProの「${user.username}」と連携されています。`
      );
    }


    return;
  }


  /* =====================================================
     LINE ID保存
     ===================================================== */

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
      "[LINE USER UPDATE ERROR]",
      updateError
    );


    if (replyToken) {

      await replyToLine(
        replyToken,
        "LINE IDの保存に失敗しました。"
      );
    }


    return;
  }


  /* =====================================================
     コードを使用済みにする
     ===================================================== */

  const {
    error: usedError
  } =
    await supabase
      .from("line_link_codes")
      .update({
        used_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        linkCode.id
      )
      .is(
        "used_at",
        null
      );


  if (usedError) {

    /*
     * LINE ID保存自体は成功しているので、
     * ログには残す。
     */

    console.error(
      "[LINE LINK CODE USED ERROR]",
      usedError
    );
  }


  /* =====================================================
     成功ログ
     ===================================================== */

  console.log(
    "[LINE LINK SUCCESS]",
    {
      userId:
        user.id,

      username:
        user.username,

      lineUserId,
    }
  );


  /* =====================================================
     LINEへ成功通知
     ===================================================== */

  if (replyToken) {

    await replyToLine(
      replyToken,
      `✅ ChanProの「${user.username}」とLINEを連携しました。\n\nこれからChanProの通知をLINEで受け取れます。`
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


    /* =====================================================
       環境変数
       ===================================================== */

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


    /* =====================================================
       LINE署名
       ===================================================== */

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


    /* =====================================================
       生Body
       ===================================================== */

    const body =
      await request.text();


    /* =====================================================
       署名検証
       ===================================================== */

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


    /* =====================================================
       JSON
       ===================================================== */

    let payload: any;

    try {

      payload =
        JSON.parse(body);

    } catch {

      return Response.json(
        {
          success: false,
          error:
            "Invalid JSON",
        },
        {
          status: 400,
        }
      );
    }


    const events =
      Array.isArray(
        payload?.events
      )
        ? payload.events
        : [];


    console.log(
      "[LINE WEBHOOK] events:",
      events.length
    );


    /* =====================================================
       LINE検証
       ===================================================== */

    if (
      events.length === 0
    ) {

      return Response.json({
        success: true,
      });
    }


    const supabase =
      getSupabaseAdmin();


    /* =====================================================
       イベント処理
       ===================================================== */

    for (
      const event of events
    ) {

      try {

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


        /* =================================================
           テキストメッセージ
           ================================================= */

        if (
          event.type === "message" &&
          event.message?.type === "text"
        ) {

          const text =
            typeof event.message.text ===
              "string"
              ? event.message.text.trim()
              : "";


          console.log(
            "[LINE MESSAGE]",
            text
          );


          /* ===============================================
             連携コード
             =============================================== */

          const normalized =
            normalizeLinkCode(
              text
            );


          if (
            isLinkCode(
              normalized
            )
          ) {

            await processLinkCode(
              supabase,
              normalized,
              lineUserId,
              event.replyToken
            );


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


              if (
                event.replyToken
              ) {

                await replyToLine(
                  event.replyToken,
                  "連携情報の取得に失敗しました。"
                );
              }


              continue;
            }


            if (!linkedUser) {

              if (
                event.replyToken
              ) {

                await replyToLine(
                  event.replyToken,
                  "このLINEアカウントはChanProと連携されていません。\n\nChanProで連携コードを発行し、そのコードをこのLINEへ送信してください。"
                );
              }


              continue;
            }


            if (
              event.replyToken
            ) {

              await replyToLine(
                event.replyToken,
                `現在、ChanProの「${linkedUser.username}」と連携されています。`
              );
            }


            continue;
          }


          /* ===============================================
             ヘルプ
             =============================================== */

          if (
            text === "連携"
          ) {

            if (
              event.replyToken
            ) {

              await replyToLine(
                event.replyToken,
                "ChanProの連携ページで連携コードを発行し、そのコード（例：CP-ABCD-2345）をこのLINEへ送信してください。\n\n連携状態を確認する場合は「連携確認」と送信してください。"
              );
            }


            continue;
          }
        }


        /* =================================================
           その他イベント
           ================================================= */

        console.log(
          "[LINE EVENT]",
          JSON.stringify(
            event
          )
        );

      } catch (eventError) {

        /*
         * 1イベントのエラーで
         * 他のイベント処理まで止めない。
         */

        console.error(
          "[LINE EVENT ERROR]",
          eventError
        );
      }
    }


    /* =====================================================
       LINEには200
       ===================================================== */

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

    service:
      "ChanPro LINE Webhook",

    message:
      "LINEからのWebhookを受け付けます。",

    link_method:
      "one-time-code",

    code_format:
      "CP-XXXX-XXXX",
  });
}
