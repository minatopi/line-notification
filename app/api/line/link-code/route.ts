import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/* =========================================================
   CORS
   ========================================================= */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};


/* =========================================================
   OPTIONS
   ========================================================= */

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
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
   安全なランダム連携コード
   ========================================================= */

function generateCode() {

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
   文字列チェック
   ========================================================= */

function getString(
  value: unknown
): string {

  return typeof value === "string"
    ? value.trim()
    : "";
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


    /* =====================================================
       JSON
       ===================================================== */

    let body: unknown;

    try {

      body =
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


    if (
      !body ||
      typeof body !== "object"
    ) {

      return Response.json(
        {
          success: false,
          error:
            "不正なリクエストです",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    const data =
      body as Record<string, unknown>;


    const username =
      getString(
        data.username
      );


    /*
     * ここはChanPro側で既存ログイン時に
     * 作成したSHA-256パスワードハッシュ。
     *
     * 平文パスワードは送らない。
     */
    const passwordHash =
      getString(
        data.passwordHash
      );


    /* =====================================================
       必須項目
       ===================================================== */

    if (!username) {

      return Response.json(
        {
          success: false,
          error:
            "username が必要です",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    if (!passwordHash) {

      return Response.json(
        {
          success: false,
          error:
            "passwordHash が必要です",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    /*
     * SHA-256 hexは64文字。
     *
     * ブラウザ側のログインと同じ形式を
     * 想定する。
     */
    if (
      !/^[a-fA-F0-9]{64}$/.test(
        passwordHash
      )
    ) {

      return Response.json(
        {
          success: false,
          error:
            "passwordHashの形式が不正です",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    const supabase =
      getSupabaseAdmin();


    /* =====================================================
       本人確認
       
       userIdは信用しない。
       username + password_hash で確認する。
       ===================================================== */

    const {
      data: user,
      error: userError,
    } =
      await supabase
        .from("users")
        .select(
          `
          id,
          username,
          password_hash,
          line_user_id,
          ban_count,
          ban_until
          `
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

      return Response.json(
        {
          success: false,
          error:
            "ユーザー確認に失敗しました",
        },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }


    if (!user) {

      console.warn(
        "[LINE LINK AUTH FAILED]",
        {
          username,
        }
      );

      /*
       * ユーザーの存在を推測されにくくするため、
       * usernameだけが存在するかどうかは
       * 返さない。
       */
      return Response.json(
        {
          success: false,
          error:
            "ユーザー名またはパスワードが正しくありません",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }


    /* =====================================================
       BAN確認
       ===================================================== */

    const now =
      Date.now();

    const banUntil =
      user.ban_until
        ? new Date(
            user.ban_until
          ).getTime()
        : null;


    if (
      banUntil &&
      !Number.isNaN(banUntil) &&
      banUntil > now
    ) {

      return Response.json(
        {
          success: false,
          error:
            "現在このアカウントは利用停止中です。",
        },
        {
          status: 403,
          headers: corsHeaders,
        }
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
        "[LINE LINK CODE DELETE ERROR]",
        deleteError
      );

      return Response.json(
        {
          success: false,
          error:
            "以前の連携コードを無効化できませんでした",
        },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }


    /* =====================================================
       新しいコード
       ===================================================== */

    const code =
      generateCode();


    /*
     * 10分間有効
     */

    const expiresAt =
      new Date(
        Date.now() +
        10 * 60 * 1000
      ).toISOString();


    /* =====================================================
       DB保存
       ===================================================== */

    const {
      data: insertedCode,
      error: insertError
    } =
      await supabase
        .from(
          "line_link_codes"
        )
        .insert({
          user_id:
            user.id,

          code,

          expires_at:
            expiresAt,

          used_at:
            null,
        })
        .select(
          "id, code, expires_at"
        )
        .single();


    if (insertError) {

      console.error(
        "[LINE LINK CODE INSERT ERROR]",
        insertError
      );

      return Response.json(
        {
          success: false,
          error:
            "連携コードの保存に失敗しました",
        },
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }


    console.log(
      "[LINE LINK CODE CREATED]",
      {
        userId:
          user.id,

        username:
          user.username,

        codeId:
          insertedCode.id,

        expiresAt:
          insertedCode.expires_at,
      }
    );


    /* =====================================================
       成功
       ===================================================== */

    return Response.json(
      {
        success: true,

        username:
          user.username,

        code:
          insertedCode.code,

        expires_at:
          insertedCode.expires_at,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );

  } catch (error) {

    console.error(
      "[LINE LINK CODE ERROR]",
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
   GET
   ========================================================= */

export async function GET() {

  return Response.json(
    {
      success: true,

      service:
        "ChanPro LINE Link Code API",

      message:
        "POSTでLINE連携コードを発行します。",

      code_format:
        "CP-XXXX-XXXX",

      expires_in:
        "10 minutes",
    },
    {
      status: 200,
      headers: corsHeaders,
    }
  );
}
