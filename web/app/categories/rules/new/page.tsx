import { PageHeader } from "../../../../components/PageHeader";
import { PolicyForm } from "../../../../components/PolicyForm";

export default function NewCategorizationRulePage() {
  return (
    <div>
      <PageHeader title="New rule" subtitle="Categorize matching transactions automatically" />
      <PolicyForm mode="create" />
    </div>
  );
}
