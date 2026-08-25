import { getLearnedPolicySuggestions } from "../../../../lib/queries";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { LearnedSuggestionItem } from "../../../../components/LearnedSuggestionItem";

export const dynamic = "force-dynamic";

export default async function LearnedSuggestionsPage() {
  const suggestions = await getLearnedPolicySuggestions();

  return (
    <div>
      <PageHeader
        title="Suggested rules"
        subtitle="Based on categories you've corrected 3 or more times for the same counterparty"
      />

      {suggestions.length === 0 ? (
        <EmptyState
          title="No suggestions right now"
          description="Correct the same counterparty to the same category a few times and a suggestion will appear here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {suggestions.map((s) => <LearnedSuggestionItem key={s.suggestionKey} suggestion={s} />)}
        </div>
      )}
    </div>
  );
}
