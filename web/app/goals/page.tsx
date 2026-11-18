import { redirect } from "next/navigation";

// Goals live under Plan (/budgets/goals); /goals used to be a 404.
export default function GoalsRedirect(): never {
  redirect("/budgets/goals");
}
