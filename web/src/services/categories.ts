import { Category } from '../types';

export function getChildCategories(categories: Category[], parentCategoryId: string | null | undefined): Category[] {
  return categories.filter((category) => (category.parentCategoryId ?? null) === (parentCategoryId ?? null));
}

export function getCategoryDescendantIds(categories: Category[], categoryId: string): string[] {
  const descendants: string[] = [];
  const visit = (parentId: string) => {
    for (const child of categories.filter((category) => category.parentCategoryId === parentId)) {
      descendants.push(child.id);
      visit(child.id);
    }
  };
  visit(categoryId);
  return descendants;
}

/** Returns a human-readable error when a category parent change is invalid. */
export function validateCategoryParent(
  categories: Category[],
  categoryId: string,
  parentCategoryId: string | null | undefined,
): string | null {
  const parentId = parentCategoryId ?? null;
  if (parentId === categoryId) return 'A category cannot be its own parent.';
  if (parentId && !categories.some((category) => category.id === parentId)) {
    return 'The selected parent category no longer exists.';
  }
  if (parentId && getCategoryDescendantIds(categories, categoryId).includes(parentId)) {
    return 'A category cannot be moved beneath one of its descendants.';
  }
  return null;
}

export function normalizeCategories(categories: Category[]): Category[] {
  const ids = new Set<string>();
  return categories.filter((category) => {
    if (!category || typeof category.id !== 'string' || !category.id.trim() || ids.has(category.id)) return false;
    ids.add(category.id);
    return true;
  }).map((category) => ({
    ...category,
    parentCategoryId: category.parentCategoryId ?? null,
    createdAt: category.createdAt || new Date().toISOString(),
  })).map((category, _index, all) => ({
    ...category,
    parentCategoryId: validateCategoryParent(all, category.id, category.parentCategoryId) ? null : category.parentCategoryId,
  }));
}

export type CategoryDeleteMode = 'delete-descendants' | 'move-contents';

export function applyCategoryDelete(
  categories: Category[],
  categoryId: string,
  mode: CategoryDeleteMode,
): Category[] {
  const target = categories.find((category) => category.id === categoryId);
  if (!target) return categories;
  const descendants = new Set(getCategoryDescendantIds(categories, categoryId));
  descendants.add(categoryId);
  if (mode === 'delete-descendants') return categories.filter((category) => !descendants.has(category.id));
  return categories.filter((category) => category.id !== categoryId).map((category) =>
    category.parentCategoryId === categoryId
      ? { ...category, parentCategoryId: target.parentCategoryId ?? null, updatedAt: new Date().toISOString() }
      : category
  );
}
