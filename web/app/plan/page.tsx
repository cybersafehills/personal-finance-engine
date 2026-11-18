import { redirect } from "next/navigation";

// "Plan" in the navigation is the budgets area; /plan used to be a 404.
export default function PlanRedirect(): never {
  redirect("/budgets");
}
