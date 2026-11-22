import { route } from "@/lib/server/http";
import { onboardingState } from "@/lib/server/companion";

// Where the family is in setup, and everything recorded so far.
export const GET = route(async () => Response.json(onboardingState()));
