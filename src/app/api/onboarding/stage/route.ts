import { HttpError, readJson, route } from "@/lib/server/http";
import { currentPlayerId } from "@/lib/server/bundle";
import { setBaseline } from "@/lib/server/assess";
import { onboardingState } from "@/lib/server/companion";
import { initialBaseline, STAGE_LABEL, type DoctorSaid } from "@/lib/shared/companion";

// Step 5: the starting baseline, from five quick questions and what the doctor said.
export const POST = route(async (req: Request) => {
  const body = await readJson<{ answers?: unknown[]; doctor?: string }>(req);
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => Number(a)) : [];
  if (answers.length < 5 || answers.some((a) => !Number.isFinite(a) || a < 0 || a > 3)) throw new HttpError(400, "Please answer all five questions");
  const doctor: DoctorSaid = body.doctor === "early" || body.doctor === "middle" || body.doctor === "late" ? body.doctor : "unsure";
  const start = initialBaseline(answers, doctor);
  setBaseline(currentPlayerId(), {
    stage: start.stage,
    level: start.level,
    trend: "first",
    reason:
      doctor === "unsure"
        ? `A starting point from your answers: ${STAGE_LABEL[start.stage].toLowerCase()}, level ${start.level}. It adjusts every day from how the games go.`
        : `Starting where the doctor said (${STAGE_LABEL[start.stage].toLowerCase()}), at level ${start.level} from your answers. It adjusts every day from how the games go.`,
    familyNote: "",
    decidedBy: "onboarding",
  });
  return Response.json(onboardingState());
});
