
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

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


/*
========================================
安全なランダムコード
========================================
*/

function generateCode() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const values =
    new Uint32Array(8);

  crypto.webcrypto.getRandomValues(
    values
  );

  let code = "";

  for (let i = 0; i < values.length; i++) {

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


/*
========================================
SHA-256
========================================
*/

function hashPassword(
  password: string
) {

  return crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");
}


/*
========================================
POST
========================================
*/

export async function POST(
  request: Request
) {

  try {

    const body =
      await request.json();

    const username =
      typeof body.username === "string"
        ? body.username.trim()
        : "";

    const userId =
      typeof body.userId === "string"
        ? body.userId.trim()
        : "";


    if (!username || !userId) {

      return Response.json(
        {
          success: false,
          error:
            "username と userId が必要です",
        },
        {
          status: 400,
        }
      );
    }


    const supabase =
      getSupabaseAdmin();


    /*
    ========================================
    ユーザー確認
    ========================================
    */

    const {
      data: user,
      error: userError
    } =
      await supabase
        .from("users")
        .select(
          "id, username, line_user_id"
        )
        .eq(
          "id",
          userId
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

      return Response.json(
        {
          success: false,
          error:
            "ユーザー確認に失敗しました",
        },
        {
          status: 500,
        }
      );
    }


    if (!user) {

      return Response.json(
        {
          success: false,
          error:
            "ユーザーが見つかりません",
        },
        {
          status: 404,
        }
      );
    }


    /*
    ========================================
    既存コードを無効化
    ========================================
    */

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


    /*
    ========================================
    新しいコード
    ========================================
    */

    const code =
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

          code,

          expires_at:
            expiresAt

        });


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
        }
      );
    }


    console.log(
      "[LINE LINK CODE CREATED]",
      {
        userId: user.id,
        username: user.username,
        codeId: code,
      }
    );


    return Response.json({

      success: true,

      code,

      expires_at:
        expiresAt

    });

  }
  catch (error) {

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
      }
    );
  }
}


/*
========================================
GET
========================================
*/

export async function GET() {

  return Response.json({

    success: true,

    service:
      "ChanPro LINE Link Code API",

    message:
      "POSTでLINE連携コードを発行します。"

  });
}
