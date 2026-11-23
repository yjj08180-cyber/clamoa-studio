import {
  getViewer,
  invite,
  login,
  logout,
  normalizeEmail,
  passwordLogin,
  savePassword,
} from "../../../lib/server/auth";
import { requiredTeam } from "../../../lib/server/config";
import {
  checkOrigin,
  errorResponse,
  HttpError,
  jsonBody,
} from "../../../lib/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    requiredTeam();
    const { action, email, password } = await jsonBody(request, 4096);
    if (action === "logout") await logout();
    else if (action === "login") await login(normalizeEmail(email));
    else if (action === "passwordLogin")
      await passwordLogin(normalizeEmail(email), password);
    else if (action === "savePassword") await savePassword(password);
    else if (action === "invite") {
      if ((await getViewer(request)).role !== "admin")
        throw new HttpError(403, "관리자만 팀원을 초대할 수 있습니다.");
      await invite(normalizeEmail(email));
    } else throw new HttpError(400, "요청할 동작을 선택해 주세요.");
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
