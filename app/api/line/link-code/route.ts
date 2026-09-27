import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";


/* =========================================================
   CORS
   ========================================================= */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};


/* =========================================================
   OPTIONS
   ========================================================= */

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}


/* =========================================================
   JSONレスポンス
   ========================================================= */

function jsonResponse(
  data: unknown,
  status = 200
) {
  return Response.json(
    data,
    {
      status,
      headers: CORS_HEADERS,
    }
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
   連携コード生成
   ========================================================= */

function generateCode() {

  /*
   * 紛らわしい文字を除外
   *
   * O / 0
   * I / 1
   * L
   */

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";


  const values =
    new Uint32Array(8);


  crypto.webcrypto.getRandomValues(
    values
  );


  let code = "";


  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    code +=
      chars[
        values[i] % chars.length
      ];
  }


  return (
    "CP-" +
    code.slice(0, 4) +
    "-" +
    code.slice(4, 8)
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
      "[LINE LINK CODE] POST received"
    );


    /* -----------------------------------------------------
       JSON
       ----------------------------------------------------- */

    let body: unknown;


    try {

      body =
        await request.json();

    } catch {

      return jsonResponse(
        {
          success: false,
          error:
            "JSONを読み込めませんでした",
        },
        400
      );
    }


    if (
      !body ||
      typeof body !== "object"
    ) {

      return jsonResponse(
        {
          success: false,
          error:
            "リクエストが不正です",
        },
        400
      );
    }


    const data =
      body as Record<string, unknown>;


    /* -----------------------------------------------------
       username
       ----------------------------------------------------- */

    const username =
      typeof data.username === "string"
        ? data.username.trim()
        : "";


    /* -----------------------------------------------------
       passwordHash
       ----------------------------------------------------- */

    const passwordHash =
      typeof data.passwordHash === "string"
        ? data.passwordHash.trim().toLowerCase()
        : "";


    /* -----------------------------------------------------
       入力確認
       ----------------------------------------------------- */

    if (!username) {

      return jsonResponse(
        {
          success: false,
          error:
            "username が必要です",
        },
        400
      );
    }


    if (!passwordHash) {

      return jsonResponse(
        {
          success: false,
          error:
            "passwordHash が必要です",
        },
        400
      );
    }


    /*
     * SHA-256のhexなら64文字
     */

    if (
      !/^[a-f0-9]{64}$/.test(
        passwordHash
      )
    ) {

      return jsonResponse(
        {
          success: false,
          error:
            "passwordHash の形式が不正です",
        },
        400
      );
    }


    /* -----------------------------------------------------
       Supabase
       ----------------------------------------------------- */

    const supabase =
      getSupabaseAdmin();


    /* =====================================================
       本人確認
       ===================================================== */

    const {
      data: user,
      error: userError,
    } =
      await supabase
        .from("users")
        .select(
          "id, username, password_hash, line_user_id"
        )
        .eq(
          "username",
          username
        )
        .eq(
          "password_hash",
          passwordHash
        )
        .maybeSingle();


    if (userError) {

      console.error(
        "[LINE LINK USER ERROR]",
        userError
      );


      return jsonResponse(
        {
          success: false,
          error:
            "ユーザー確認に失敗しました",
        },
        500
      );
    }


    /* -----------------------------------------------------
       ユーザーなし
       ----------------------------------------------------- */

    if (!user) {

      /*
       * ユーザーが存在しない場合と
       * パスワードが違う場合を
       * 外部から区別できないようにする。
       */

      return jsonResponse(
        {
          success: false,
          error:
            "ユーザー名またはパスワードが正しくありません",
        },
        401
      );
    }


    console.log(
      "[LINE LINK USER VERIFIED]",
      {
        userId: user.id,
        username: user.username,
      }
    );


    /* =====================================================
       BAN確認
       ===================================================== */

    const banUntil =
      (user as any).ban_until;


    if (
      banUntil &&
      new Date(banUntil).getTime() >
        Date.now()
    ) {

      return jsonResponse(
        {
          success: false,
          error:
            "このアカウントは現在利用できません",
        },
        403
      );
    }


    /* =====================================================
       既存の未使用コードを削除
       ===================================================== */

    const {
      error: deleteError
    } =
      await supabase
        .from("line_link_codes")
        .delete()
        .eq(
          "user_id",
          user.id
        )
        .is(
          "used_at",
          null
        );


    if (deleteError) {

      console.error(
        "[LINE LINK OLD CODE DELETE ERROR]",
        deleteError
      );


      return jsonResponse(
        {
          success: false,
          error:
            "以前の連携コードを無効化できませんでした",
        },
        500
      );
    }


    /* =====================================================
       新しいコード生成
       ===================================================== */

    let code = "";
    let inserted = false;


    /*
     * UUID衝突など極めて低いが、
     * DBのUNIQUE制約に備えて複数回試行。
     */

    for (
      let attempt = 0;
      attempt < 5;
      attempt++
    ) {

      const candidate =
        generateCode();


      const expiresAt =
        new Date(
          Date.now() +
          10 * 60 * 1000
        ).toISOString();


      const {
        error: insertError
      } =
        await supabase
          .from("line_link_codes")
          .insert({
            user_id:
              user.id,

            code:
              candidate,

            expires_at:
              expiresAt,
          });


      if (!insertError) {

        code =
          candidate;

        inserted = true;

        break;
      }


      console.error(
        "[LINE LINK CODE INSERT ERROR]",
        insertError
      );


      /*
       * UNIQUE衝突なら次のコードを試す。
       */

      if (
        insertError.code !==
        "23505"
      ) {

        return jsonResponse(
          {
            success: false,
            error:
              "連携コードの保存に失敗しました",
          },
          500
        );
      }
    }


    if (!inserted) {

      return jsonResponse(
        {
          success: false,
          error:
            "連携コードを生成できませんでした。もう一度お試しください。",
        },
        500
      );
    }


    /* =====================================================
       有効期限
       ===================================================== */

    const expiresAt =
      new Date(
        Date.now() +
        10 * 60 * 1000
      ).toISOString();


    /*
     * 注意:
     * 実際のexpires_atはinsert時に設定済み。
     * ここではHTMLへ返す表示用として
     * 同じ10分後を返す。
     */


    console.log(
      "[LINE LINK CODE CREATED]",
      {
        userId:
          user.id,

        username:
          user.username,

        code,
      }
    );


    /* =====================================================
       完了
       ===================================================== */

    return jsonResponse({

      success:
        true,

      code,

      expires_at:
        expiresAt,

      username:
        user.username,

      already_linked:
        !!user.line_user_id,

    });

  } catch (error) {

    console.error(
      "[LINE LINK CODE ERROR]",
      error
    );


    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Internal Server Error",
      },
      500
    );
  }
}


/* =========================================================
   GET
   ========================================================= */

export async function GET() {

  return jsonResponse({

    success:
      true,

    service:
      "ChanPro LINE Link Code API",

    message:
      "POSTでLINE連携コードを発行します。",

  });
}
