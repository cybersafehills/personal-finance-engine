export type CategoryTotal = {
  /** "Uncategorized" stands for transactions with no category. */
  category: string;
  totalRwf: number;
  transactionCount: number;
};

export type CategoriesData = {
  categories: CategoryTotal[];
  /** True when a very long history hit the server's safety cap: the totals are incomplete. */
  truncated: boolean;
};

export const UNCATEGORIZED = "Uncategorized";
