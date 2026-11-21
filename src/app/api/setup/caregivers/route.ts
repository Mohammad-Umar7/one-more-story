import { readJson, route, str } from "@/lib/server/http";
import { addCaregiver, deleteCaregiver, setAlertRecipient } from "@/lib/server/content";
import { getCaregivers, getPlayer } from "@/lib/server/bundle";
import type { CaregiverKind } from "@/lib/shared/types";

// POST   {name, relation, kind}  add a trusted person
// PUT    {alertCaregiverId}      choose who gets alerts
// DELETE {id}                    remove a person
export const POST = route(async (req: Request) => {
  const body = await readJson<{ name?: string; relation?: string; kind?: CaregiverKind }>(req);
  const { id } = addCaregiver({
    name: str(body.name, "name", 40),
    relation: typeof body.relation === "string" ? body.relation : "",
    kind: body.kind ?? "relative",
  });
  return Response.json({ id, caregivers: getCaregivers() });
});

export const PUT = route(async (req: Request) => {
  const body = await readJson<{ alertCaregiverId?: string }>(req);
  setAlertRecipient(str(body.alertCaregiverId, "alertCaregiverId", 60));
  return Response.json({ player: getPlayer(), caregivers: getCaregivers() });
});

export const DELETE = route(async (req: Request) => {
  const body = await readJson<{ id?: string }>(req);
  deleteCaregiver(str(body.id, "id", 60));
  return Response.json({ caregivers: getCaregivers() });
});
